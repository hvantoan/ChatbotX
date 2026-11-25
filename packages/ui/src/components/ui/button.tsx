"use client"

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import type { VariantProps } from "class-variance-authority"

import { cn } from "@inboxos.io/ui/lib/utils"

import { buttonVariants } from "./button-variants"

export interface ButtonProps
  extends ButtonPrimitive.Props,
  VariantProps<typeof buttonVariants> { }

function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, ButtonPrimitive, buttonVariants }
