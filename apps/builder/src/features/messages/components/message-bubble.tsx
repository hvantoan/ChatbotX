import { cn } from "@inboxos.io/ui/lib/utils"
import { cva, type VariantProps } from "class-variance-authority"

const messageBubbleVariant = cva("flex gap-2", {
  variants: {
    variant: {
      left: "flex self-start",
      right: "flex flex-row-reverse self-end",
      full: "w-full",
    },
  },
  defaultVariants: {
    variant: "left",
  },
})

export type MessageProps = React.ComponentProps<"div"> &
  VariantProps<typeof messageBubbleVariant>

const MessageBubble = ({ className, variant, ...props }: MessageProps) => (
  <div
    className={cn(messageBubbleVariant({ variant, className }))}
    {...props}
  />
)
MessageBubble.displayName = "MessageBubble"

export { MessageBubble, messageBubbleVariant }
