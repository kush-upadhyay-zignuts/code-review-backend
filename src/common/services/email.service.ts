import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

type EmailTransport = 'resend' | 'smtp' | 'none';

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const transport = this.resolveTransport();
    const frontendUrl = this.configService.get<string>('email.frontendUrl');

    if (transport === 'none') {
      this.logger.warn(
        'Password-reset email is disabled. Set EMAIL_USER+EMAIL_PASS (SMTP), or RESEND_API_KEY+EMAIL_FROM (optional HTTPS API).',
      );
      return;
    }

    this.logger.log(
      `Password-reset email transport: ${transport.toUpperCase()} | reset links → ${frontendUrl}`,
    );

    if (transport === 'smtp' && this.isCloudRuntime()) {
      this.logger.warn(
        'SMTP on cloud hosts (e.g. Render free tier) often blocks ports 587/465. If emails fail with ETIMEDOUT, set RESEND_API_KEY instead.',
      );
    }
  }

  private isCloudRuntime(): boolean {
    return Boolean(
      process.env.RENDER ||
        process.env.RAILWAY_ENVIRONMENT ||
        process.env.FLY_APP_NAME ||
        process.env.HEROKU_APP_NAME,
    );
  }

  private isResendConfigured(): boolean {
    const resendKey = this.configService.get<string>('email.resendApiKey')?.trim();
    const resendFrom = this.configService.get<string>('email.from')?.trim();
    return Boolean(resendKey && resendFrom);
  }

  private resolveTransport(): EmailTransport {
    if (this.isResendConfigured()) return 'resend';

    const user = this.configService.get<string>('email.user')?.trim();
    const pass = this.configService.get<string>('email.pass')?.trim();
    if (user && pass) return 'smtp';

    return 'none';
  }

  private createSmtpTransport() {
    const user = this.configService.get<string>('email.user')?.trim();
    const pass = this.configService.get<string>('email.pass')?.trim();

    if (!user || !pass) {
      return null;
    }

    const port = this.configService.get<number>('email.port', 587);

    return nodemailer.createTransport({
      host: this.configService.get<string>('email.host', 'smtp.gmail.com'),
      port,
      secure: port === 465,
      auth: { user, pass },
      requireTLS: true,
      connectionTimeout: 30_000,
      socketTimeout: 30_000,
      greetingTimeout: 30_000,
    });
  }

  private async sendViaResend(
    to: string,
    subject: string,
    html: string,
    text: string,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const apiKey = this.configService.get<string>('email.resendApiKey')?.trim();
    const from = this.configService.get<string>('email.from')?.trim();

    if (!apiKey || !from) {
      return {
        ok: false,
        message: 'Resend is not fully configured. Set RESEND_API_KEY and EMAIL_FROM, or use SMTP.',
      };
    }

    if (from.includes('resend.dev') && !from.includes('onboarding@resend.dev')) {
      this.logger.warn('Using resend.dev sender — only your Resend account email can receive mail until a domain is verified.');
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: from.includes('<') ? from : `"CodeReview AI" <${from}>`,
          to: [to],
          subject,
          html,
          text,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        let message = 'Failed to send password reset email';
        try {
          const parsed = JSON.parse(body) as { message?: string };
          if (parsed.message) message = parsed.message;
        } catch {
          if (body) message = body;
        }
        this.logger.error(`Resend API error (${response.status}): ${message}`);
        return { ok: false, message };
      }

      return { ok: true };
    } catch (error) {
      this.logger.error('Resend API request failed', error);
      return {
        ok: false,
        message: 'Email service is unreachable. Please try again later.',
      };
    }
  }

  private async sendViaSmtp(
    to: string,
    subject: string,
    html: string,
    text: string,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const transport = this.createSmtpTransport();
    const from = this.configService.get<string>('email.user')?.trim();

    if (!transport || !from) {
      return {
        ok: false,
        message: 'Email is not configured. Set EMAIL_USER and EMAIL_PASS on the server.',
      };
    }

    try {
      await transport.sendMail({
        from: `"CodeReview AI" <${from}>`,
        to,
        subject,
        html,
        text,
      });
      return { ok: true };
    } catch (error) {
      this.logger.error('SMTP send failed', error);
      return {
        ok: false,
        message: 'Failed to send email via SMTP. Check server email configuration.',
      };
    }
  }

  async sendPasswordResetEmail(
    to: string,
    resetUrl: string,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const subject = 'Reset your password';
    const html = `
      <p>You requested a password reset for your CodeReview AI account.</p>
      <p><a href="${resetUrl}">Click here to reset your password</a></p>
      <p>This link expires in 1 hour. If you did not request this, ignore this email.</p>
    `;
    const text = `Reset your password: ${resetUrl}\n\nThis link expires in 1 hour.`;

    const transport = this.resolveTransport();

    if (transport === 'none') {
      const message =
        'Email is not configured. Set EMAIL_USER+EMAIL_PASS (SMTP), or RESEND_API_KEY+EMAIL_FROM.';
      this.logger.warn(message);
      return { ok: false, message };
    }

    const result =
      transport === 'resend'
        ? await this.sendViaResend(to, subject, html, text)
        : await this.sendViaSmtp(to, subject, html, text);

    if (result.ok) {
      this.logger.log(`Password reset email sent to ${to}`);
    }

    return result;
  }
}
