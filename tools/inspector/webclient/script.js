document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    const connectBtn = document.getElementById('connect-btn');
    const agentUrlInput = document.getElementById('agent-url');
    const collapsibleHeader = document.querySelector('.collapsible-header');
    const collapsibleContent = document.querySelector('.collapsible-content');
    const agentCardContent = document.getElementById('agent-card-content');
    const validationErrorsContainer = document.getElementById('validation-errors');
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const chatMessages = document.getElementById('chat-messages');
    const debugConsole = document.getElementById('debug-console');
    const debugHandle = document.getElementById('debug-handle');
    const debugContent = document.getElementById('debug-content');
    const clearConsoleBtn = document.getElementById('clear-console-btn');
    const toggleConsoleBtn = document.getElementById('toggle-console-btn');
    const jsonModal = document.getElementById('json-modal');
    const modalJsonContent = document.getElementById('modal-json-content');
    const modalCloseBtn = document.querySelector('.modal-close-btn');

    let isResizing = false;
    let rawLogStore = {};
    const messageJsonStore = {};

    debugHandle.addEventListener('mousedown', (e) => {
        if (e.target === debugHandle || e.target.tagName === 'SPAN') {
            isResizing = true;
            document.body.style.userSelect = 'none';
            document.body.style.pointerEvents = 'none';
        }
    });

    window.addEventListener('mousemove', (e) => {
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
        rawLogStore = {};
    });

    toggleConsoleBtn.addEventListener('click', () => {
        const isHidden = debugConsole.classList.toggle('hidden');
        toggleConsoleBtn.textContent = isHidden ? 'Show' : 'Hide';
    });
    
    modalCloseBtn.addEventListener('click', () => jsonModal.classList.add('hidden'));
    jsonModal.addEventListener('click', (e) => {
        if (e.target === jsonModal) {
            jsonModal.classList.add('hidden');
        }
    });

    const showJsonInModal = (jsonData) => {
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
                validationErrorsContainer.innerHTML = `<h3>Validation Errors</h3><ul>${data.validation_errors.map(e => `<li>${e}</li>`).join('')}</ul>`;
            } else {
                validationErrorsContainer.innerHTML = '<p style="color: green;">Agent card is valid.</p>';
            }
        } catch (error) {
            validationErrorsContainer.innerHTML = `<p style="color: red;">Error: ${error.message}</p>`;
        }
    });

    socket.on('client_initialized', (data) => {
        if (data.status === 'success') {
            chatInput.disabled = false;
            sendBtn.disabled = false;
            chatMessages.innerHTML = '<p class="placeholder-text">Ready to chat.</p>';
            debugContent.innerHTML = '';
            rawLogStore = {};
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
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    socket.on('agent_response', (event) => {
        const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        messageJsonStore[messageId] = event;

        // <-- Fix: Pass validation errors to appendMessage
        const validationErrors = event.validation_errors || [];

        if (event.error) {
            appendMessage('agent error', `[error] Error: ${event.error}`, messageId, false, validationErrors);
            return;
        }

        switch (event.kind) {
            case 'task':
                appendMessage('agent progress', `[${event.kind}] Task created with status: ${event.status.state}`, messageId, false, validationErrors);
                break;
            case 'status-update':
                const statusText = event.status?.message?.parts?.[0]?.text;
                if (statusText) {
                    appendMessage('agent progress', `[${event.kind}] Server responded with: ${statusText}`, messageId, false, validationErrors);
                }
                break;
            case 'artifact-update':
                const artifactTextPart = event.artifact?.parts?.find(p => p.text);
                if (artifactTextPart) {
                    appendMessage('agent', `[${event.kind}] ${artifactTextPart.text}`, messageId, false, validationErrors);
                }

                const filePart = event.artifact?.parts?.find(p => p.file?.uri);
                if (filePart) {
                    const { uri, mimeType } = filePart.file;
                    const messageHtml = `[${event.kind}] File received (${mimeType}): <a href="${uri}" target="_blank" rel="noopener noreferrer">Open Link</a>`;
                    appendMessage('agent', messageHtml, messageId, true, validationErrors);
                }
                break;
            case 'message':
                const textPart = event.parts?.find(p => p.text);
                if (textPart) {
                    appendMessage('agent', `[${event.kind}] ${textPart.text}`, messageId, false, validationErrors);
                }
                break;
        }
    });

    socket.on('debug_log', (log) => {
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
    
    function appendMessage(sender, content, messageId, isHtml = false, validationErrors = []) {
        const placeholder = chatMessages.querySelector('.placeholder-text');
        if (placeholder) placeholder.remove();

        const messageElement = document.createElement('div');
        messageElement.className = `message ${sender.replace(' ', '-')}`;
        
        // <-- Fix: Create a container for the message content and validation status
        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';

        if (isHtml) {
            messageContent.innerHTML = content;
        } else {
            messageContent.textContent = content;
        }
        
        messageElement.appendChild(messageContent);

        // <-- Fix: Add validation status indicator
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

        messageElement.addEventListener('click', (e) => {
            if (e.target.tagName !== 'A') {
                const jsonData = sender === 'user' ? rawLogStore[messageId]?.request : messageJsonStore[messageId];
                showJsonInModal(jsonData);
            }
        });
        
        chatMessages.appendChild(messageElement);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
});