export interface GroqMessage {
  role: "user" | "assistant";
  content: string;
}

export interface GroqChatCompletionResponse {
  choices: Array<{ message: { role: string; content: string } }>;
}
