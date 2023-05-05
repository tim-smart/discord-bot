import {
  Config,
  ConfigSecret,
  Data,
  Effect,
  Layer,
  Option,
  Tag,
  flow,
  pipe,
} from "bot/_common"
import * as Str from "bot/utils/String"
import { ChatCompletionRequestMessage, Configuration, OpenAIApi } from "openai"

export interface OpenAIOptions {
  readonly apiKey: ConfigSecret.ConfigSecret
  readonly organization: Option.Option<ConfigSecret.ConfigSecret>
}

export class OpenAIError extends Data.TaggedClass("OpenAIError")<{
  readonly error: unknown
}> {}

export interface OpenAIMessage {
  readonly bot: boolean
  readonly content: string
}

const make = (params: OpenAIOptions) => {
  const config = new Configuration({
    apiKey: ConfigSecret.value(params.apiKey),
    organization: Option.getOrUndefined(
      Option.map(params.organization, ConfigSecret.value),
    ),
  })

  const client = new OpenAIApi(config)

  const call = <A>(f: (api: OpenAIApi, signal: AbortSignal) => Promise<A>) =>
    Effect.tryCatchPromiseInterrupt(
      signal => f(client, signal),
      error => new OpenAIError({ error }),
    )

  const generateTitle = (prompt: string) =>
    Effect.flatMap(
      call((_, signal) =>
        _.createChatCompletion(
          {
            model: "gpt-3.5-turbo",
            messages: [
              {
                role: "user",
                content: `Create a short title summarizing the following text:

${Str.truncateWords(prompt, 75)}`,
              },
            ],
            temperature: 0.25,
            max_tokens: 64,
            top_p: 1,
            frequency_penalty: 0,
            presence_penalty: 0,
          },
          { signal },
        ),
      ),
      _ =>
        pipe(
          Option.fromNullable(_.data.choices[0]?.message?.content),
          Option.map(cleanTitle),
        ),
    )

  const generateReply = (
    title: string,
    messages: ReadonlyArray<OpenAIMessage>,
  ) =>
    Effect.flatMap(
      call((_, signal) =>
        _.createChatCompletion(
          {
            model: "gpt-3.5-turbo",
            messages: [
              {
                role: "system",
                content: `You are Effect Bot, a helpful assistant for the Effect Discord community.

Please keep responses under 2000 characters.

The title of this conversation is "${title}".`,
              },
              ...messages.map(
                ({ content, bot }): ChatCompletionRequestMessage => ({
                  role: bot ? "assistant" : "user",
                  content: Str.truncateWords(content, 100),
                }),
              ),
            ],
          },
          { signal },
        ),
      ),
      _ => Option.fromNullable(_.data.choices[0]?.message?.content),
    )

  return { client, call, generateTitle, generateReply } as const
}

export interface OpenAI extends ReturnType<typeof make> {}
export const OpenAI = Tag<OpenAI>()
export const makeLayer = (config: Config.Config.Wrap<OpenAIOptions>) =>
  Layer.effect(OpenAI, Effect.map(Effect.config(Config.unwrap(config)), make))

const cleanTitle = flow(Str.firstParagraph, Str.removeQuotes, Str.removePeriod)
