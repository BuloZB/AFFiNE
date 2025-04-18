import { partition } from 'lodash-es';

import { AIProvider } from './ai-provider';
import type { CopilotClient } from './copilot-client';
import { delay, toTextStream } from './event-source';
import type { PromptKey } from './prompt';

const TIMEOUT = 50000;

export type TextToTextOptions = {
  client: CopilotClient;
  docId: string;
  workspaceId: string;
  promptName?: PromptKey;
  sessionId?: string | Promise<string>;
  content?: string;
  attachments?: (string | Blob | File)[];
  params?: Record<string, any>;
  timeout?: number;
  stream?: boolean;
  signal?: AbortSignal;
  retry?: boolean;
  workflow?: boolean;
  isRootSession?: boolean;
  postfix?: (text: string) => string;
};

export type ToImageOptions = TextToTextOptions & {
  seed?: string;
};

async function resizeImage(blob: Blob | File): Promise<Blob | null> {
  let src = '';
  try {
    src = URL.createObjectURL(blob);
    const img = new Image();
    img.src = src;
    await new Promise(resolve => {
      img.onload = resolve;
    });

    const canvas = document.createElement('canvas');
    // keep aspect ratio
    const scale = Math.min(1024 / img.width, 1024 / img.height);
    canvas.width = Math.floor(img.width * scale);
    canvas.height = Math.floor(img.height * scale);

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return await new Promise(resolve =>
        canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.8)
      );
    }
  } catch (e) {
    console.error(e);
  } finally {
    if (src) URL.revokeObjectURL(src);
  }
  return null;
}

async function createSessionMessage({
  client,
  docId,
  workspaceId,
  promptName = 'Chat With AFFiNE AI',
  content,
  sessionId: providedSessionId,
  attachments,
  params,
}: TextToTextOptions): Promise<{
  sessionId: string;
  messageId: string;
}> {
  if (!promptName && !providedSessionId) {
    throw new Error('promptName or sessionId is required');
  }
  const hasAttachments = attachments && attachments.length > 0;
  const sessionId = await (providedSessionId ??
    client.createSession({
      workspaceId,
      docId,
      promptName,
    }));

  const options: Parameters<CopilotClient['createMessage']>[0] = {
    sessionId,
    content,
    params,
  };

  if (hasAttachments) {
    const [stringAttachments, blobs] = partition(
      attachments,
      attachment => typeof attachment === 'string'
    ) as [string[], (Blob | File)[]];
    options.attachments = stringAttachments;
    options.blobs = (
      await Promise.all(
        blobs.map(resizeImage).map(async blob => {
          const file = await blob;
          if (!file) return null;
          return new File([file], sessionId, {
            type: file.type,
          });
        })
      )
    ).filter(Boolean) as File[];
  }

  const messageId = await client.createMessage(options);
  return {
    messageId,
    sessionId,
  };
}

export function textToText({
  client,
  docId,
  workspaceId,
  promptName,
  content,
  attachments,
  params,
  sessionId,
  stream,
  signal,
  timeout = TIMEOUT,
  retry = false,
  workflow = false,
  isRootSession = false,
  postfix,
}: TextToTextOptions) {
  let _sessionId: string;
  let _messageId: string | undefined;

  if (stream) {
    return {
      [Symbol.asyncIterator]: async function* () {
        if (retry) {
          const retrySessionId =
            (await sessionId) ?? AIProvider.LAST_ACTION_SESSIONID;
          _sessionId = retrySessionId;
          _messageId = undefined;
        } else {
          const message = await createSessionMessage({
            client,
            docId,
            workspaceId,
            promptName,
            content,
            attachments,
            params,
            sessionId,
          });
          _sessionId = message.sessionId;
          _messageId = message.messageId;
        }

        const eventSource = client.chatTextStream(
          {
            sessionId: _sessionId,
            messageId: _messageId,
          },
          workflow ? 'workflow' : undefined
        );
        AIProvider.LAST_ACTION_SESSIONID = _sessionId;
        if (isRootSession) {
          AIProvider.LAST_ROOT_SESSION_ID = _sessionId;
        }

        if (signal) {
          if (signal.aborted) {
            eventSource.close();
            return;
          }
          signal.onabort = () => {
            eventSource.close();
          };
        }
        if (postfix) {
          const messages: string[] = [];
          for await (const event of toTextStream(eventSource, {
            timeout,
            signal,
          })) {
            if (event.type === 'message') {
              messages.push(event.data);
            }
          }
          yield postfix(messages.join(''));
        } else {
          for await (const event of toTextStream(eventSource, {
            timeout,
            signal,
          })) {
            if (event.type === 'message') {
              yield event.data;
            }
          }
        }
      },
    };
  } else {
    return Promise.race([
      timeout
        ? delay(timeout).then(() => {
            throw new Error('Timeout');
          })
        : null,
      (async function () {
        if (retry) {
          const retrySessionId =
            (await sessionId) ?? AIProvider.LAST_ACTION_SESSIONID;
          _sessionId = retrySessionId;
          _messageId = undefined;
        } else {
          const message = await createSessionMessage({
            client,
            docId,
            workspaceId,
            promptName,
            content,
            attachments,
            params,
            sessionId,
          });
          _sessionId = message.sessionId;
          _messageId = message.messageId;
        }

        AIProvider.LAST_ACTION_SESSIONID = _sessionId;
        if (isRootSession) {
          AIProvider.LAST_ROOT_SESSION_ID = _sessionId;
        }

        return client.chatText({
          sessionId: _sessionId,
          messageId: _messageId,
        });
      })(),
    ]);
  }
}

// Only one image is currently being processed
export function toImage({
  docId,
  workspaceId,
  promptName,
  content,
  attachments,
  params,
  seed,
  sessionId,
  signal,
  timeout = TIMEOUT,
  retry = false,
  workflow = false,
  client,
}: ToImageOptions) {
  let _sessionId: string;
  let _messageId: string | undefined;
  return {
    [Symbol.asyncIterator]: async function* () {
      if (retry) {
        const retrySessionId =
          (await sessionId) ?? AIProvider.LAST_ACTION_SESSIONID;
        _sessionId = retrySessionId;
        _messageId = undefined;
      } else {
        const { messageId, sessionId } = await createSessionMessage({
          docId,
          workspaceId,
          promptName,
          content,
          attachments,
          params,
          client,
        });
        _sessionId = sessionId;
        _messageId = messageId;
      }

      const eventSource = client.imagesStream(
        _sessionId,
        _messageId,
        seed,
        workflow ? 'workflow' : undefined
      );
      AIProvider.LAST_ACTION_SESSIONID = _sessionId;

      for await (const event of toTextStream(eventSource, {
        timeout,
        signal,
      })) {
        if (event.type === 'attachment') {
          yield event.data;
        }
      }
    },
  };
}
