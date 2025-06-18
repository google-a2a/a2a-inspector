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

document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement;
    const agentUrlInput = document.getElementById('agent-url') as HTMLInputElement;
    const collapsibleHeader = document.querySelector('.collapsible-header') as HTMLElement;
    const collapsibleContent = document.querySelector('.collapsible-content') as HTMLElement;
    const agentCardContent = document.getElementById('agent-card-content') as HTMLPreElement;
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
        let url = agentUrlInput.value;
        if (!url) { return alert('Please enter an agent URL.'); }
        if (!/^https?:\/\//i.test(url)) { url = 'http://' + url; }

        agentCardContent.textContent = '';
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

            agentCardContent.textContent = JSON.stringify(data.card, null, 2);
            validationErrorsContainer.innerHTML = '<p class="placeholder-text">Initializing client session...</p>';
            socket.emit('initialize_client', { url: url });

            if (data.validation_errors.length > 0) {
                validationErrorsContainer.innerHTML = `<h3>Validation Errors</h3><ul>${data.validation_errors.map((e: string) => `<li>${e}</li>`).join('')}</ul>`;
            } else {
                validationErrorsContainer.innerHTML = '<p style="color: green;">Agent card is valid.</p>';
            }
        } catch (error) {
            validationErrorsContainer.innerHTML = `<p style="color: red;">Error: ${(error as Error).message}</p>`;
        }
    });

    socket.on('client_initialized', (data: { status: string, message?: string }) => {
        if (data.status === 'success') {
            chatInput.disabled = false;
            sendBtn.disabled = false;
            chatMessages.innerHTML = '<p class="placeholder-text">Ready to chat.</p>';
            debugContent.innerHTML = '';
            Object.keys(rawLogStore).forEach(key => delete rawLogStore[key]);
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
        const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        messageJsonStore[messageId] = event;

        const validationErrors = event.validation_errors || [];

        if (event.error) {
            const messageHtml = `<span class="kind-chip kind-chip-error">error</span> Error: ${escapeHtml(event.error)}`;
            appendMessage('agent error', messageHtml, messageId, true, validationErrors);
            return;
        }

        switch (event.kind) {
            case 'task':
                if (event.status) {
                    const messageHtml = `<span class="kind-chip kind-chip-task">${event.kind}</span> Task created with status: ${escapeHtml(event.status.state)}`;
                    appendMessage('agent progress', messageHtml, messageId, true, validationErrors);
                }
                break;
            case 'status-update':
                const statusText = event.status?.message?.parts?.[0]?.text;
                if (statusText) {
                    const messageHtml = `<span class="kind-chip kind-chip-status-update">${event.kind}</span> Server responded with: ${escapeHtml(statusText)}`;
                    appendMessage('agent progress', messageHtml, messageId, true, validationErrors);
                }
                break;
            case 'artifact-update':
                event.artifact?.parts?.forEach(p => {
                    if ('text' in p && p.text) {
                        const messageHtml = `<span class="kind-chip kind-chip-artifact-update">${event.kind}</span> ${escapeHtml(p.text)}`;
                        appendMessage('agent', messageHtml, messageId, true, validationErrors);
                    }
                    if ('file' in p && p.file) {
                        const { uri, mimeType } = p.file;
                        const messageHtml = `<span class="kind-chip kind-chip-artifact-update">${event.kind}</span> File received (${escapeHtml(mimeType)}): <a href="${uri}" target="_blank" rel="noopener noreferrer">Open Link</a>`;
                        appendMessage('agent', messageHtml, messageId, true, validationErrors);
                    }
                });
                break;
            case 'message':
                const textPart = event.parts?.find(p => p.text);
                if (textPart) {
                    const messageHtml = `<span class="kind-chip kind-chip-message">${event.kind}</span> ${escapeHtml(textPart.text)}`;
                    appendMessage('agent', messageHtml, messageId, true, validationErrors);
                }
                break;
        }
    });

    socket.on('debug_log', (log: DebugLog) => {
        const logEntry = document.createElement('div');
        const timestamp = new Date().toLocaleTimeString();
        
        logEntry.className = `log-entry log-${log.type}`;
        logEntry.innerHTML = `
            <div>
                <span class="log-timestamp">${timestamp}</span>
                <strong>${log.type.toUpperCase()}</strong>
            </div>
            <pre>${JSON.stringify(log.data, null, 2)}</pre>
        `;
        debugContent.appendChild(logEntry);
        
        if (!rawLogStore[log.id]) {
            rawLogStore[log.id] = {};
        }
        rawLogStore[log.id][log.type] = log.data;
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
