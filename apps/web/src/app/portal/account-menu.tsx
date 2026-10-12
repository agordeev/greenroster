"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import { signOutAction } from "@/app/actions/auth";

export function AccountMenu({
  email,
  role,
}: Readonly<{ email: string; role: string }>) {
  const menu = useRef<HTMLDetailsElement>(null);

  // <details> opens and closes on its own; this adds the ways people expect a
  // menu to close: clicking elsewhere, pressing Escape, or tabbing away.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const details = menu.current;
      if (details?.open && !details.contains(event.target as Node))
        details.open = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const details = menu.current;
      if (event.key !== "Escape" || !details?.open) return;
      details.open = false;
      details.querySelector("summary")?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <details
      ref={menu}
      className="account-menu"
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && !event.currentTarget.contains(next))
          event.currentTarget.open = false;
      }}
      onClick={(event) => {
        if ((event.target as Element).closest("a"))
          event.currentTarget.open = false;
      }}
    >
      <summary>
        <span className="account-avatar" aria-hidden="true">
          {email.trim().charAt(0).toUpperCase()}
        </span>
        Account
      </summary>
      <div className="account-menu-panel">
        <p className="account-menu-identity">
          <small>Signed in as</small>
          <strong>{email}</strong>
          <span>{role}</span>
        </p>
        <ul>
          <li>
            <Link href="/account">Account e-mail</Link>
          </li>
          <li>
            <Link href="/account/privacy">Privacy requests</Link>
          </li>
          <li>
            <Link href="/help">Help</Link>
          </li>
        </ul>
        <form action={signOutAction}>
          <button type="submit">Sign out</button>
        </form>
      </div>
    </details>
  );
}
