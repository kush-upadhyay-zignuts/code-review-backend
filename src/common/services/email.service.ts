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
        'Password-reset email is disabled. Set EMAIL_USER+EMAIL_PASS (SMTP) or RESEND_API_KEY (HTTPS) in environment variables.',
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

  private resolveTransport(): EmailTransport {
    const resendKey = this.configService.get<string>('email.resendApiKey')?.trim();
    if (resendKey) return 'resend';

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
  ): Promise<boolean> {
    const apiKey = this.configService.get<string>('email.resendApiKey')?.trim();
    const from =
      this.configService.get<string>('email.from')?.trim() ||
      this.configService.get<string>('email.user')?.trim();

    if (!apiKey || !from) {
      this.logger.warn('Resend API key or EMAIL_FROM is missing');
      return false;
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
        this.logger.error(`Resend API error (${response.status}): ${body}`);
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error('Resend API request failed', error);
      return false;
    }
  }

  private async sendViaSmtp(
    to: string,
    subject: string,
    html: string,
    text: string,
  ): Promise<boolean> {
    const transport = this.createSmtpTransport();
    const from = this.configService.get<string>('email.user')?.trim();

    if (!transport || !from) {
      return false;
    }

    try {
      await transport.sendMail({
        from: `"CodeReview AI" <${from}>`,
        to,
        subject,
        html,
        text,
      });
      return true;
    } catch (error) {
      this.logger.error('SMTP send failed', error);
      return false;
    }
  }

  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<boolean> {
    const subject = 'Reset your password';
    const html = `
      <p>You requested a password reset for your CodeReview AI account.</p>
      <p><a href="${resetUrl}">Click here to reset your password</a></p>
      <p>This link expires in 1 hour. If you did not request this, ignore this email.</p>
    `;
    const text = `Reset your password: ${resetUrl}\n\nThis link expires in 1 hour.`;

    const transport = this.resolveTransport();

    if (transport === 'none') {
      this.logger.warn(
        'Email not configured. Set EMAIL_USER+EMAIL_PASS or RESEND_API_KEY in environment.',
      );
      return false;
    }

    const sent =
      transport === 'resend'
        ? await this.sendViaResend(to, subject, html, text)
        : await this.sendViaSmtp(to, subject, html, text);

    if (sent) {
      this.logger.log(`Password reset email sent to ${to}`);
    }

    return sent;
  }
}
