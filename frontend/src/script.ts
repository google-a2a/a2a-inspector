import { io } from "socket.io-client";

interface AgentResponseEvent {
    kind: 'task' | 'status-update' | 'artifact-update' | 'message';
    id: string;
    error?: string;
    status?: {
        state: string;
        message?: { parts?: { text?: string }[] };
    };
    artifact?: {
        parts?: ({ file?: { uri: string; mimeType: string } } | { text?: string })[];
    };
    parts?: { text?: string }[];
    validation_errors: string[];
}

interface DebugLog {
    type: 'request' | 'response' | 'error' | 'validation_error';
    data: any;
    id: string;
}

// Declare hljs global from CDN
declare global {
    interface Window {
        hljs: any;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement;
    const agentUrlInput = document.getElementById('agent-url') as HTMLInputElement;
    const collapsibleHeader = document.querySelector('.collapsible-header') as HTMLElement;
    const collapsibleContent = document.querySelector('.collapsible-content') as HTMLElement;
    const agentCardCodeContent = document.getElementById('agent-card-content') as HTMLElement;
    const validationErrorsContainer = document.getElementById('validation-errors') as HTMLElement;
    const chatInput = document.getElementById('chat-input') as HTMLInputElement;
    const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
    const chatMessages = document.getElementById('chat-messages') as HTMLElement;
    const debugConsole = document.getElementById('debug-console') as HTMLElement;
    const debugHandle = document.getElementById('debug-handle') as HTMLElement;
    const debugContent = document.getElementById('debug-content') as HTMLElement;
    const clearConsoleBtn = document.getElementById('clear-console-btn') as HTMLButtonElement;
    const toggleConsoleBtn = document.getElementById('toggle-console-btn') as HTMLButtonElement;
    const jsonModal = document.getElementById('json-modal') as HTMLElement;
    const modalJsonContent = document.getElementById('modal-json-content') as HTMLPreElement;
    const modalCloseBtn = document.querySelector('.modal-close-btn') as HTMLElement;

    function escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Renders basic Markdown elements (specifically bold with **) into HTML,
     * while also escaping other HTML to prevent XSS.
     * Also converts newline characters (\n) to <br> for line breaks.
     * @param markdownText The text containing potential Markdown.
     * @returns HTML string with Markdown rendered, newlines converted, and other HTML escaped.
     */
    function renderMarkdown(markdownText: string): string {
        let result = '';
        let lastIndex = 0;
        // Regex to find **bolded text**: captures content inside asterisks in group 1
        const regex = /\*\*(.*?)\*\*/g;
        let match;

        while ((match = regex.exec(markdownText)) !== null) {
            result += escapeHtml(markdownText.substring(lastIndex, match.index));
            result += `<strong>${escapeHtml(match[1])}</strong>`;
            lastIndex = regex.lastIndex;
        }

        result += escapeHtml(markdownText.substring(lastIndex));

        return result.replace(/\n/g, '<br>');
    }

    let isResizing = false;
    const rawLogStore: { [key: string]: { [key: string]: any } } = {};
    const messageJsonStore: { [key: string]: AgentResponseEvent } = {};

    debugHandle.addEventListener('mousedown', (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target === debugHandle || target.tagName === 'SPAN') {
            isResizing = true;
            document.body.style.userSelect = 'none';
            document.body.style.pointerEvents = 'none';
        }
    });

    window.addEventListener('mousemove', (e: MouseEvent) => {
        if (!isResizing) return;
        const newHeight = window.innerHeight - e.clientY;
        if (newHeight > 40 && newHeight < window.innerHeight * 0.9) {
            debugConsole.style.height = `${newHeight}px`;
        }
    });

    window.addEventListener('mouseup', () => {
        isResizing = false;
        document.body.style.userSelect = '';
        document.body.style.pointerEvents = '';
    });

    collapsibleHeader.addEventListener('click', () => {
        collapsibleHeader.classList.toggle('collapsed');
        collapsibleContent.classList.toggle('collapsed');
    });

    clearConsoleBtn.addEventListener('click', () => {
        debugContent.innerHTML = '';
        Object.keys(rawLogStore).forEach(key => delete rawLogStore[key]);
    });

    toggleConsoleBtn.addEventListener('click', () => {
        const isHidden = debugConsole.classList.toggle('hidden');
        toggleConsoleBtn.textContent = isHidden ? 'Show' : 'Hide';
    });
    
    modalCloseBtn.addEventListener('click', () => jsonModal.classList.add('hidden'));
    jsonModal.addEventListener('click', (e: MouseEvent) => {
        if (e.target === jsonModal) {
            jsonModal.classList.add('hidden');
        }
    });

    const showJsonInModal = (jsonData: any) => {
        if (jsonData) {
            let jsonString = JSON.stringify(jsonData, null, 2);
            jsonString = jsonString.replace(/"method": "([^"]+)"/g, '<span class="json-highlight">"method": "$1"</span>');
            modalJsonContent.innerHTML = jsonString;
            jsonModal.classList.remove('hidden');
        }
    };
    
    connectBtn.addEventListener('click', async () => {
        let url = agentUrlInput.value.trim();
        if (!url) { return alert('Please enter an agent URL.'); }
        if (!/^https?:\/\//i.test(url)) { url = 'http://' + url; }

        agentCardCodeContent.textContent = '';
        validationErrorsContainer.innerHTML = '<p class="placeholder-text">Fetching Agent Card...</p>';
        chatInput.disabled = true;
        sendBtn.disabled = true;

        try {
            const response = await fetch('/agent-card', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: url, sid: socket.id })
            });
            const data = await response.json();
            if (!response.ok) { throw new Error(data.error || `HTTP error! status: ${response.status}`); }

            agentCardCodeContent.textContent = JSON.stringify(data.card, null, 2);
            if (window.hljs) {
                window.hljs.highlightElement(agentCardCodeContent);
            } else {
                console.warn('highlight.js not loaded. Syntax highlighting skipped.');
            }

            validationErrorsContainer.innerHTML = '<p class="placeholder-text">Initializing client session...</p>';
            socket.emit('initialize_client', { url: url });

            if (data.validation_errors.length > 0) {
                validationErrorsContainer.innerHTML = `<h3>Validation Errors</h3><ul>${data.validation_errors.map((e: string) => `<li>${e}</li>`).join('')}</ul>`;
            } else {
                validationErrorsContainer.innerHTML = '<p style="color: green;">Agent card is valid.</p>';
            }
        } catch (error) {
            validationErrorsContainer.innerHTML = `<p style="color: red;">Error: ${(error as Error).message}</p>`;
            chatInput.disabled = true;
            sendBtn.disabled = true;
        }
    });

    socket.on('client_initialized', (data: { status: string, message?: string }) => {
        if (data.status === 'success') {
            chatInput.disabled = false;
            sendBtn.disabled = false;
            chatMessages.innerHTML = '<p class="placeholder-text">Ready to chat.</p>';
            debugContent.innerHTML = '';
            Object.keys(rawLogStore).forEach(key => delete rawLogStore[key]);
            Object.keys(messageJsonStore).forEach(key => delete messageJsonStore[key]);
        } else {
            validationErrorsContainer.innerHTML = `<p style="color: red;">Error initializing client: ${data.message}</p>`;
        }
    });

    const sendMessage = () => {
        const messageText = chatInput.value;
        if (messageText.trim() && !chatInput.disabled) {
            const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            appendMessage('user', messageText, messageId); 
            socket.emit('send_message', { message: messageText, id: messageId });
            chatInput.value = '';
        }
    };

    sendBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e: KeyboardEvent) => {
        if (e.key === 'Enter') sendMessage();
    });

    socket.on('agent_response', (event: AgentResponseEvent) => {
        const displayMessageId = `display-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        messageJsonStore[displayMessageId] = event;

        const validationErrors = event.validation_errors || [];

        if (event.error) {
            const messageHtml = `<span class="kind-chip kind-chip-error">error</span> Error: ${escapeHtml(event.error)}`;
            appendMessage('agent error', messageHtml, displayMessageId, true, validationErrors);
            return;
        }

        switch (event.kind) {
            case 'task':
                if (event.status) {
                    const messageHtml = `<span class="kind-chip kind-chip-task">${event.kind}</span> Task created with status: ${escapeHtml(event.status.state)}`;
                    appendMessage('agent progress', messageHtml, displayMessageId, true, validationErrors);
                }
                break;
            case 'status-update':
                const statusText = event.status?.message?.parts?.[0]?.text;
                if (statusText) {
                    const renderedContent = renderMarkdown(statusText);
                    const messageHtml = `<span class="kind-chip kind-chip-status-update">${event.kind}</span> Server responded with: ${renderedContent}`;
                    appendMessage('agent progress', messageHtml, displayMessageId, true, validationErrors);
                }
                break;
            case 'artifact-update':
                event.artifact?.parts?.forEach(p => {
                    if ('text' in p && p.text) {
                        const renderedContent = renderMarkdown(p.text);
                        const messageHtml = `<span class="kind-chip kind-chip-artifact-update">${event.kind}</span> ${renderedContent}`;
                        appendMessage('agent', messageHtml, displayMessageId, true, validationErrors);
                    }
                    if ('file' in p && p.file) {
                        const { uri, mimeType } = p.file;
                        const messageHtml = `<span class="kind-chip kind-chip-artifact-update">${event.kind}</span> File received (${escapeHtml(mimeType)}): <a href="${uri}" target="_blank" rel="noopener noreferrer">Open Link</a>`;
                        appendMessage('agent', messageHtml, displayMessageId, true, validationErrors);
                    }
                });
                break;
            case 'message':
                const textPart = event.parts?.find(p => p.text);
                if (textPart && textPart.text) { // Ensure textPart and textPart.text exist
                    const renderedContent = renderMarkdown(textPart.text);
                    const messageHtml = `<span class="kind-chip kind-chip-message">${event.kind}</span> ${renderedContent}`;
                    appendMessage('agent', messageHtml, displayMessageId, true, validationErrors);
                }
                break;
        }
    });

    socket.on('debug_log', (log: DebugLog) => {
        const logEntry = document.createElement('div');
        const timestamp = new Date().toLocaleTimeString();
        
        let jsonString = JSON.stringify(log.data, null, 2);
        jsonString = jsonString.replace(/"method": "([^"]+)"/g, '<span class="json-highlight">"method": "$1"</span>');

        logEntry.className = `log-entry log-${log.type}`;
        logEntry.innerHTML = `
            <div>
                <span class="log-timestamp">${timestamp}</span>
                <strong>${log.type.toUpperCase()}</strong>
            </div>
            <pre>${jsonString}</pre>
        `;
        debugContent.appendChild(logEntry);
        
        if (!rawLogStore[log.id]) {
            rawLogStore[log.id] = {};
        }
        rawLogStore[log.id][log.type] = log.data;
        debugContent.scrollTop = debugContent.scrollHeight;
    });
    
    function appendMessage(sender: string, content: string, messageId: string, isHtml: boolean = false, validationErrors: string[] = []) {
        const placeholder = chatMessages.querySelector('.placeholder-text');
        if (placeholder) placeholder.remove();

        const messageElement = document.createElement('div');
        messageElement.className = `message ${sender.replace(' ', '-')}`;
        
        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';

        if (isHtml) {
            messageContent.innerHTML = content;
        } else {
            messageContent.textContent = content;
        }
        
        messageElement.appendChild(messageContent);

        const statusIndicator = document.createElement('span');
        statusIndicator.className = 'validation-status';
        if (sender !== 'user') {
            if (validationErrors.length > 0) {
                statusIndicator.classList.add('invalid');
                statusIndicator.textContent = '⚠️';
                statusIndicator.title = validationErrors.join('\n');
            } else {
                statusIndicator.classList.add('valid');
                statusIndicator.textContent = '✅';
                statusIndicator.title = 'Message is compliant';
            }
            messageElement.appendChild(statusIndicator);
        }

        messageElement.addEventListener('click', (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName !== 'A') {
                const jsonData = sender === 'user' ? rawLogStore[messageId]?.request : messageJsonStore[messageId];
                showJsonInModal(jsonData);
            }
        });
        
        chatMessages.appendChild(messageElement);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
});
