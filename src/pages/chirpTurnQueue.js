export function takeNextReadyTurn(queue, inFlightConversations = new Set()) {
  const index = queue.findIndex(item => !inFlightConversations.has(item?.conversationIdentity))
  if (index < 0) return null
  const [next] = queue.splice(index, 1)
  return next
}
