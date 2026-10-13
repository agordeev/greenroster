"use client";

import { ChevronDownIcon } from "lucide-react";
import Link from "next/link";
import { useId } from "react";

import { signOutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const itemClass = "min-h-11 cursor-pointer px-3";

export function AccountMenu({
  email,
  role,
}: Readonly<{ email: string; role: string }>) {
  const signOutFormId = useId();

  return (
    <>
      {/* The form stays mounted outside the menu so sign-out still submits
          after the menu closes. */}
      <form id={signOutFormId} action={signOutAction} hidden />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="group gap-2 justify-self-end rounded-full pr-3 pl-[0.3125rem]"
          >
            <span
              className="grid size-8 place-items-center rounded-full bg-primary text-primary-foreground"
              aria-hidden="true"
            >
              {email.trim().charAt(0).toUpperCase()}
            </span>
            Account
            <ChevronDownIcon
              className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
              aria-hidden="true"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={8}
          className="w-[min(18rem,calc(100vw-2rem))]"
        >
          <DropdownMenuLabel className="grid gap-1 p-3 font-normal">
            <small className="text-xs text-muted-foreground">
              Signed in as
            </small>
            <strong className="text-sm text-foreground [overflow-wrap:anywhere]">
              {email}
            </strong>
            <span className="font-mono text-[0.6875rem] font-bold tracking-widest text-primary uppercase">
              {role}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild className={itemClass}>
            <Link href="/account">Account e-mail</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className={itemClass}>
            <Link href="/account/privacy">Privacy requests</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className={itemClass}>
            <Link href="/help">Help</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild className={`${itemClass} w-full font-bold`}>
            <button type="submit" form={signOutFormId}>
              Sign out
            </button>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
