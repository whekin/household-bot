interface OpenAiResponseContentItem {
  text?: string | { value?: string | null } | null
}

interface OpenAiResponseOutputItem {
  content?: OpenAiResponseContentItem[] | null
}

export interface OpenAiResponsePayload {
  output_text?: string | null
  output?: OpenAiResponseOutputItem[] | null
}

function normalizeResponseText(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

function contentItemText(contentItem: OpenAiResponseContentItem): string | null {
  if (typeof contentItem.text === 'string') {
    return normalizeResponseText(contentItem.text)
  }

  if (contentItem.text && typeof contentItem.text.value === 'string') {
    return normalizeResponseText(contentItem.text.value)
  }

  return null
}

export function extractOpenAiResponseText(payload: OpenAiResponsePayload): string | null {
  const directOutputText = normalizeResponseText(payload.output_text)
  if (directOutputText) {
    return directOutputText
  }

  const nestedOutputText = payload.output
    ?.flatMap((outputItem) => outputItem.content ?? [])
    .map(contentItemText)
    .filter((value): value is string => value !== null)
    .join('\n')

  return normalizeResponseText(nestedOutputText)
}

export function parseJsonFromResponseText<T>(text: string): T | null {
  const normalizedText = normalizeResponseText(text)
  if (!normalizedText) {
    return null
  }

  try {
    return JSON.parse(normalizedText) as T
  } catch {
    const fencedMatch = normalizedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
    if (!fencedMatch?.[1]) {
      return null
    }

    try {
      return JSON.parse(fencedMatch[1]) as T
    } catch {
      return null
    }
  }
}
