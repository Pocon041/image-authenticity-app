import { Fragment, type ReactNode } from 'react'

// Render the small Markdown subset used in answers without HTML or external resources.
function inline(text: string) {
  return text
    .split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g)
    .map((part, index) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={index}>{part.slice(2, -2)}</strong>
      ) : part.startsWith('`') && part.endsWith('`') ? (
        <code key={index}>{part.slice(1, -1)}</code>
      ) : (
        <Fragment key={index}>{part}</Fragment>
      )
    )
}

export function ResponseText({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const blocks: ReactNode[] = []
  let paragraph: string[] = [],
    list: string[] = [],
    ordered = false
  const flushParagraph = () => {
    if (paragraph.length) blocks.push(<p key={blocks.length}>{inline(paragraph.join('\n'))}</p>)
    paragraph = []
  }
  const flushList = () => {
    if (list.length) {
      const items = list.map((line, index) => <li key={index}>{inline(line)}</li>)
      blocks.push(
        ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>
      )
    }
    list = []
  }
  for (const line of text.split('\n')) {
    const heading = /^\s*#{1,6}\s+(.+?)\s*$/.exec(line)
    const label = /^\s*\*\*(重点位置|判断依据|可能方式|分析依据)[：:]?\*\*\s*$/.exec(line)
    const unorderedItem = /^\s*[-*]\s+(.+)$/.exec(line)
    const orderedItem = /^\s*\d+[.)、]\s+(.+)$/.exec(line)
    if (heading || label) {
      flushParagraph()
      flushList()
      blocks.push(<h4 key={blocks.length}>{inline((heading ?? label)![1])}</h4>)
    } else if (unorderedItem || orderedItem) {
      flushParagraph()
      const nextOrdered = !!orderedItem
      if (list.length && ordered !== nextOrdered) flushList()
      ordered = nextOrdered
      list.push((orderedItem ?? unorderedItem)![1])
    } else if (!line.trim()) {
      flushParagraph()
      flushList()
    } else {
      flushList()
      paragraph.push(line)
    }
  }
  flushParagraph()
  flushList()
  return (
    <div className="conversation-summary" data-testid="explanation-summary">
      {blocks}
      {streaming && <span className="conversation-cursor" aria-hidden="true" />}
    </div>
  )
}
