#!/bin/bash

# Update imports
sed -i 's/import { useEffect, useRef, memo, useState, useCallback } from "react";/import { useEffect, useRef, memo, useState, useCallback, useMemo } from "react";\nimport { adaptEventsToMessages, groupLLMChunks } from "@\/lib\/event-adapter";\nimport { useThreadStore } from "@\/store\/thread-store";/' swe-ui/components/thread-monitor/ThreadTimeline.tsx

# Delete MessageContent interface
sed -i '11,23d' swe-ui/components/thread-monitor/ThreadTimeline.tsx

# Update ThreadTimelineProps
sed -i 's/  messages: MessageContent\[\];/  threadId: string;/g' swe-ui/components/thread-monitor/ThreadTimeline.tsx
sed -i 's/  thread: ThreadState;//g' swe-ui/components/thread-monitor/ThreadTimeline.tsx

# Replace Component signature
sed -i 's/export const ThreadTimeline = memo(function ThreadTimeline({ messages, thread, connectionState }: ThreadTimelineProps) {/export const ThreadTimeline = memo(function ThreadTimeline({ threadId, connectionState }: ThreadTimelineProps) {\n  const events = useThreadStore((state) => state.threads[threadId]?.events);\n  const threadStatus = useThreadStore((state) => state.threads[threadId]?.status);\n\n  const messages = useMemo(\n    () => (events ? groupLLMChunks(adaptEventsToMessages(events)) : []),\n    [events],\n  );\n/g' swe-ui/components/thread-monitor/ThreadTimeline.tsx

# Update internals
sed -i 's/\[messages, thread.status\]/[messages, threadStatus]/g' swe-ui/components/thread-monitor/ThreadTimeline.tsx
sed -i 's/thread.status === "running"/threadStatus === "running"/g' swe-ui/components/thread-monitor/ThreadTimeline.tsx
