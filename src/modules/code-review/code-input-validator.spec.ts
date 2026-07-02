import { validateCodeInput } from './code-input-validator';

const DEFAULT_CODE = `function divide(a, b) {
  return a / b;
}

console.log(divide(10, 0));`;

const REACT_SNIPPET = `import React, { useState, useEffect } from "react";

function UserDashboard() {
  const [users, setUsers] = useState([]);
  useEffect(() => {
    setInterval(() => console.log("tick"), 1000);
  }, []);
  return <div>{users.map((u) => u.name)}</div>;
}`;

describe('validateCodeInput', () => {
  it('accepts default JavaScript sample', () => {
    expect(validateCodeInput(DEFAULT_CODE).valid).toBe(true);
  });

  it('accepts React component snippet', () => {
    expect(validateCodeInput(REACT_SNIPPET).valid).toBe(true);
  });

  it('accepts Python, SQL, CSS, shell, and Kotlin snippets', () => {
    expect(validateCodeInput('def add(a, b):\n    return a + b').valid).toBe(true);
    expect(validateCodeInput('SELECT id, name FROM users WHERE active = 1;').valid).toBe(
      true,
    );
    expect(validateCodeInput('.card { display: flex; gap: 8px; }').valid).toBe(true);
    expect(validateCodeInput('#!/bin/bash\necho "hello"').valid).toBe(true);
    expect(validateCodeInput('fun main() {\n  println("hi")\n}').valid).toBe(true);
  });

  it('rejects empty, whitespace, and comment-only input', () => {
    expect(validateCodeInput('').valid).toBe(false);
    expect(validateCodeInput('   \n  ').valid).toBe(false);
    expect(validateCodeInput('// only comments\n/* block */').valid).toBe(false);
  });

  it('rejects plain prose and keyword-stuffed sentences', () => {
    expect(
      validateCodeInput('Hello this is just some random text please review it').valid,
    ).toBe(false);
    expect(
      validateCodeInput(
        'if this is the code that you want me to review please help thanks',
      ).valid,
    ).toBe(false);
  });

  it('rejects snippets that are too short', () => {
    expect(validateCodeInput('x=1').valid).toBe(false);
  });

  it('accepts short but structural one-liners', () => {
    expect(validateCodeInput('const x = 1;').valid).toBe(true);
  });

  it('accepts a multi-line React dashboard snippet', () => {
    expect(validateCodeInput(REACT_SNIPPET).valid).toBe(true);
    expect(
      validateCodeInput(`import React, { useState, useEffect } from "react";
function UserDashboard() {
  const [users, setUsers] = useState([]);
  useEffect(() => { fetchUsers(); });
  return <div>{users.map((user) => user.name)}</div>;
}`).valid,
    ).toBe(true);
  });

  it('accepts Next.js layout.tsx style snippets', () => {
    const layoutTsx = `import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import { AppProviders } from "@/components/providers/app-providers";
import "./globals.css";

export const metadata: Metadata = {
  title: 'CodeReview AI',
  description: 'AI-powered code review with streaming analysis',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AppRouterCacheProvider>
          <AppProviders>{children}</AppProviders>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}`;

    expect(validateCodeInput(layoutTsx).valid).toBe(true);
  });

  it('rejects casual prose and parenthetical sentences', () => {
    expect(validateCodeInput('This is normal text (not code)').valid).toBe(false);
    expect(validateCodeInput('Hello world please review this thanks').valid).toBe(
      false,
    );
  });

  it('rejects prose that mentions code keywords in plain English', () => {
    expect(
      validateCodeInput('import is not here\nexport neither\nfunction words in text')
        .valid,
    ).toBe(false);
    expect(validateCodeInput('class is in session today for all students.').valid).toBe(
      false,
    );
    expect(validateCodeInput('interface with the user through text only').valid).toBe(
      false,
    );
    expect(validateCodeInput('type of document: plain text').valid).toBe(false);
  });
});
