import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly configService: ConfigService) {}

  private createTransport() {
    const user = this.configService.get<string>('email.user')?.trim();
    const pass = this.configService.get<string>('email.pass')?.trim();

    if (!user || !pass) {
      return null;
    }

    return nodemailer.createTransport({
      host: this.configService.get<string>('email.host', 'smtp.gmail.com'),
      port: this.configService.get<number>('email.port', 587),
      secure: false,
      auth: { user, pass },
      // Fail fast if SMTP is unreachable (e.g. port blocked on cloud servers)
      connectionTimeout: 10_000,
      socketTimeout: 10_000,
      greetingTimeout: 10_000,
    });
  }

  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<boolean> {
    const transport = this.createTransport();
    const from = this.configService.get<string>('email.user');

    if (!transport || !from) {
      this.logger.warn(
        'Email not configured. Set EMAIL_USER and EMAIL_PASS in .env',
      );
      return false;
    }

    try {
      await transport.sendMail({
        from: `"CodeReview AI" <${from}>`,
        to,
        subject: 'Reset your password',
        html: `
          <p>You requested a password reset for your CodeReview AI account.</p>
          <p><a href="${resetUrl}">Click here to reset your password</a></p>
          <p>This link expires in 1 hour. If you did not request this, ignore this email.</p>
        `,
        text: `Reset your password: ${resetUrl}\n\nThis link expires in 1 hour.`,
      });
      return true;
    } catch (error) {
      this.logger.error('Failed to send password reset email', error);
      return false;
    }
  }
}
