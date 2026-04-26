# SSE Endpoint Manual Testing Guide

This document provides manual testing instructions for the Server-Sent Events (SSE) endpoint implementation.

## Prerequisites

1. Start the development server:
   ```bash
   bun run dev
   ```

2. Ensure the server is running on `http://localhost:7860`

## Test 1: Basic SSE Connection

### Objective
Verify that the SSE endpoint accepts connections and returns proper headers.

### Steps

1. Open a terminal and run:
   ```bash
   curl -N http://localhost:7860/stream?threadId=test-123
   ```

2. Verify the response headers:
   - Status: 200 OK
   - Content-Type: text/event-stream
   - Cache-Control: no-cache
   - Connection: keep-alive

### Expected Result
The connection should stay open and wait for events. You should see the connection established without immediate timeout.

### Cleanup
Press `Ctrl+C` to close the connection.

---

## Test 2: Event Reception from Agent Run

### Objective
Verify that SSE events are emitted when an agent execution occurs.

### Steps

1. **Terminal 1**: Connect to SSE stream
   ```bash
   curl -N http://localhost:7860/stream?threadId=test-agent-events
   ```

2. **Terminal 2**: Trigger an agent run with the same threadId
   ```bash
   curl -X POST http://localhost:7860/run \
     -H "Content-Type: application/json" \
     -d '{"input": "say hello", "threadId": "test-agent-events"}'
   ```

### Expected Result
In Terminal 1, you should see SSE events in the format:
```
data: {"type":"session_start","threadId":"test-agent-events","timestamp":1234567890}

data: {"type":"llm_start","model":"gpt-4","timestamp":1234567890}

data: {"type":"llm_chunk","content":"Hello","timestamp":1234567890}

data: {"type":"llm_end","totalTokens":150,"timestamp":1234567890}

data: {"type":"session_end","threadId":"test-agent-events","timestamp":1234567890}
```

### Cleanup
Press `Ctrl+C` in Terminal 1 to close the connection.

---

## Test 3: Multiple Concurrent Streams

### Objective
Verify that multiple clients can connect to different streams simultaneously.

### Steps

1. **Terminal 1**: Connect to stream for thread A
   ```bash
   curl -N http://localhost:7860/stream?threadId=thread-a
   ```

2. **Terminal 2**: Connect to stream for thread B
   ```bash
   curl -N http://localhost:7860/stream?threadId=thread-b
   ```

3. **Terminal 3**: Connect to stream for thread C
   ```bash
   curl -N http://localhost:7860/stream?threadId=thread-c
   ```

4. **Terminal 4**: Trigger agent runs for each thread
   ```bash
   # Trigger for thread-a
   curl -X POST http://localhost:7860/run \
     -H "Content-Type: application/json" \
     -d '{"input": "say hello from A", "threadId": "thread-a"}'

   # Trigger for thread-b
   curl -X POST http://localhost:7860/run \
     -H "Content-Type: application/json" \
     -d '{"input": "say hello from B", "threadId": "thread-b"}'

   # Trigger for thread-c
   curl -X POST http://localhost:7860/run \
     -H "Content-Type: application/json" \
     -d '{"input": "say hello from C", "threadId": "thread-c"}'
   ```

### Expected Result
- Each terminal should only receive events for its respective threadId
- Terminal 1 should only see events from thread-a
- Terminal 2 should only see events from thread-b
- Terminal 3 should only see events from thread-c

### Cleanup
Press `Ctrl+C` in each terminal to close connections.

---

## Test 4: Default ThreadId Behavior

### Objective
Verify that the endpoint uses "default-session" when no threadId is provided.

### Steps

1. Open a terminal and run:
   ```bash
   curl -N http://localhost:7860/stream
   ```

2. In another terminal, trigger an agent run without threadId:
   ```bash
   curl -X POST http://localhost:7860/run \
     -H "Content-Type: application/json" \
     -d '{"input": "say hello"}'
   ```

### Expected Result
The SSE stream should receive events with `threadId: "default-session"` in the session_start event.

### Cleanup
Press `Ctrl+C` to close the connection.

---

## Test 5: Authentication (When API_SECRET_KEY is Set)

### Objective
Verify that authentication is enforced when `API_SECRET_KEY` is configured.

### Prerequisites
Set the environment variable:
```bash
export API_SECRET_KEY=your-secret-key
bun run dev
```

### Steps

1. Try to connect without authentication:
   ```bash
   curl -N http://localhost:7860/stream?threadId=test-auth
   ```

2. Try to connect with authentication:
   ```bash
   curl -N http://localhost:7860/stream?threadId=test-auth&token=your-secret-key
   ```

   Or with Bearer token:
   ```bash
   curl -N -H "Authorization: Bearer your-secret-key" \
     http://localhost:7860/stream?threadId=test-auth
   ```

### Expected Result
- Request 1 should return `401 Unauthorized`
- Request 2 should return `200 OK` and establish the SSE connection
- Request 3 should return `200 OK` and establish the SSE connection

### Cleanup
Press `Ctrl+C` to close the connection.

---

## Test 6: Stream Reconnection

### Objective
Verify that clients can reconnect to the same thread after disconnection.

### Steps

1. **Terminal 1**: Connect to SSE stream
   ```bash
   curl -N http://localhost:7860/stream?threadId=test-reconnect
   ```

2. Wait a few seconds, then press `Ctrl+C` to disconnect.

3. **Terminal 1**: Reconnect to the same thread
   ```bash
   curl -N http://localhost:7860/stream?threadId=test-reconnect
   ```

4. **Terminal 2**: Trigger an agent run
   ```bash
   curl -X POST http://localhost:7860/run \
     -H "Content-Type: application/json" \
     -d '{"input": "say hello", "threadId": "test-reconnect"}'
   ```

### Expected Result
The reconnected stream should receive events from the agent run.

### Cleanup
Press `Ctrl+C` to close the connection.

---

## Test 7: Event Types Validation

### Objective
Verify that all event types are properly formatted.

### Steps

1. Connect to SSE stream:
   ```bash
   curl -N http://localhost:7860/stream?threadId=test-event-types
   ```

2. Trigger an agent run that uses tools:
   ```bash
   curl -X POST http://localhost:7860/run \
     -H "Content-Type: application/json" \
     -d '{"input": "what files are in the current directory?", "threadId": "test-event-types"}'
   ```

### Expected Result
You should see various event types including:
- `session_start` - Initial session event
- `llm_start` - LLM call starts
- `llm_chunk` - Streaming LLM responses (if supported)
- `tool_call` - Tool invocation starts
- `tool_result` - Tool execution completes
- `llm_end` - LLM call completes
- `session_end` - Session terminates

Each event should be valid JSON with `type` and `timestamp` fields.

### Cleanup
Press `Ctrl+C` to close the connection.

---

## Test 8: Browser JavaScript Client

### Objective
Test SSE integration with a browser-based JavaScript client.

### Steps

1. Create an HTML file `sse-test.html`:
   ```html
   <!DOCTYPE html>
   <html>
   <head>
       <title>SSE Test</title>
   </head>
   <body>
       <h1>SSE Test</h1>
       <div id="events"></div>
       <button onclick="triggerAgent()">Run Agent</button>

       <script>
           const threadId = 'browser-test-' + Date.now();
           const eventSource = new EventSource(
               `http://localhost:7860/stream?threadId=${threadId}`
           );

           const eventsDiv = document.getElementById('events');

           eventSource.onmessage = (event) => {
               const data = JSON.parse(event.data);
               const p = document.createElement('p');
               p.textContent = `[${data.type}] ${JSON.stringify(data)}`;
               eventsDiv.appendChild(p);
               console.log('SSE Event:', data);
           };

           eventSource.onerror = (error) => {
               console.error('SSE Error:', error);
           };

           function triggerAgent() {
               fetch('http://localhost:7860/run', {
                   method: 'POST',
                   headers: { 'Content-Type': 'application/json' },
                   body: JSON.stringify({
                       input: 'say hello',
                       threadId: threadId
                   })
               });
           }
       </script>
   </body>
   </html>
   ```

2. Open the HTML file in a web browser.

3. Click the "Run Agent" button.

### Expected Result
- The SSE connection should establish automatically
- Events should appear on the page as the agent runs
- The browser console should log all events

### Cleanup
Close the browser tab.

---

## Troubleshooting

### Connection Times Out Immediately
- Check if the server is running: `curl http://localhost:7860/health`
- Verify the port is correct (default: 7860)

### No Events Received
- Verify the threadId matches between the SSE connection and the agent run
- Check browser console for errors
- Ensure the agent run completes successfully

### Authentication Errors
- Verify `API_SECRET_KEY` is set on the server
- Check that the token is passed correctly (query param or Bearer header)
- Ensure the token matches exactly

### Stream Disconnects Unexpectedly
- Check server logs for errors
- Verify network stability
- Some proxies/load balancers may timeout long-lived connections

---

## Performance Testing

### Load Testing Multiple Connections

Use a tool like `ab` (Apache Bench) or `wrk` to test concurrent connections:

```bash
# Using ab (Apache Bench)
ab -n 100 -c 10 http://localhost:7860/stream?threadId=load-test

# Using wrk
wrk -t4 -c100 -d30s http://localhost:7860/stream?threadId=load-test
```

### Expected Results
- Server should handle 100+ concurrent connections
- Response time should remain under 100ms for connection establishment
- No memory leaks or connection leaks

---

## Integration with Existing Features

### Telegram Bot Integration
When a Telegram message triggers an agent run, the SSE stream for that thread should emit events if a client is connected.

### GitHub Webhook Integration
When a GitHub webhook triggers an agent run, the SSE stream should emit events for that execution.

### Verification
1. Connect an SSE stream with a specific threadId
2. Trigger an agent run via Telegram or GitHub webhook
3. Verify events appear in the SSE stream

---

## Conclusion

These manual tests verify the SSE endpoint implementation works correctly across various scenarios. The automated tests in `tests/stream.test.ts` cover the basic functionality, while these manual tests provide end-to-end verification.
