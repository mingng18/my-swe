export function getTelegramUpdateType(update: Record<string, any>): string {
  // Telegram update types are mutually exclusive
  // We check for the most common ones first for performance
  if ("message" in update) return "message";
  if ("callback_query" in update) return "callback_query";
  if ("edited_message" in update) return "edited_message";
  if ("channel_post" in update) return "channel_post";
  if ("edited_channel_post" in update) return "edited_channel_post";
  if ("inline_query" in update) return "inline_query";
  if ("chosen_inline_result" in update) return "chosen_inline_result";
  if ("shipping_query" in update) return "shipping_query";
  if ("pre_checkout_query" in update) return "pre_checkout_query";
  if ("poll" in update) return "poll";
  if ("poll_answer" in update) return "poll_answer";
  if ("my_chat_member" in update) return "my_chat_member";
  if ("chat_member" in update) return "chat_member";
  if ("chat_join_request" in update) return "chat_join_request";

  // Fallback if it's a new or unknown update type
  for (const k in update) {
    if (k !== "update_id") {
      return k;
    }
  }

  return "unknown";
}
