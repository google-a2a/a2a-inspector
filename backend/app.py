import sys
import traceback

from typing import Any
from uuid import uuid4

import httpx
import socketio

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates


try:
    from a2a.client import A2ACardResolver, A2AClient
    from a2a.types import (
        AgentCard,
        JSONRPCErrorResponse,
        Message,
        MessageSendConfiguration,
        MessageSendParams,
        Role,
        SendMessageRequest,
        SendStreamingMessageRequest,
        TextPart,
    )
    from validators import validate_agent_card, validate_message
except ImportError:
    print(
        'FATAL: a2a-sdk library not found. Please re-install dependencies using requirements.txt'
    )
    sys.exit()

app = FastAPI()
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
socket_app = socketio.ASGIApp(sio)
app.mount('/socket.io', socket_app)

app.mount('/static', StaticFiles(directory='../frontend/public'), name='static')
templates = Jinja2Templates(directory='../frontend/public')

clients: dict[str, tuple[httpx.AsyncClient, A2AClient, AgentCard]] = {}


@app.get('/', response_class=HTMLResponse)
async def index(request: Request) -> HTMLResponse:
    """Serve the main index.html page."""
    return templates.TemplateResponse('index.html', {'request': request})


@app.post('/agent-card')
async def get_agent_card(request: Request) -> JSONResponse:
    """Fetch and validate the agent card from a given URL."""
    response_data: dict[str, Any] = {}
    response_status = 500
    request_data = {}
    sid = None

    try:
        request_data = await request.json()
        agent_url = request_data.get('url')
        sid = request_data.get('sid')

        if not agent_url or not sid:
            return JSONResponse(
                content={'error': 'Agent URL and SID are required.'},
                status_code=400,
            )

        await sio.emit(
            'debug_log',
            {
                'type': 'request',
                'data': {'endpoint': '/agent-card', 'payload': request_data},
                'id': 'http-agent-card',
            },
            to=sid,
        )

        async with httpx.AsyncClient(timeout=30.0) as client:
            card_resolver = A2ACardResolver(client, str(agent_url))
            card = await card_resolver.get_agent_card()
            card_data = card.model_dump(exclude_none=True)
            validation_errors = validate_agent_card(card_data)

            response_data = {
                'card': card_data,
                'validation_errors': validation_errors,
            }
            response_status = 200

    except Exception as e:
        traceback.print_exc()
        response_data = {'error': f'An internal server error occurred: {e}'}
        response_status = 500

    finally:
        if sid:
            await sio.emit(
                'debug_log',
                {
                    'type': 'response',
                    'data': {
                        'status': response_status,
                        'payload': response_data,
                    },
                    'id': 'http-agent-card',
                },
                to=sid,
            )

    return JSONResponse(content=response_data, status_code=response_status)


@sio.on('initialize_client')
async def handle_initialize_client(sid: str, data: dict[str, Any]) -> None:
    """Handle the 'initialize_client' socket.io event."""
    agent_url = data.get('url')
    try:
        httpx_client = httpx.AsyncClient(timeout=600.0)
        card_resolver = A2ACardResolver(httpx_client, str(agent_url))
        card = await card_resolver.get_agent_card()
        a2a_client = A2AClient(httpx_client, agent_card=card)
        clients[sid] = (httpx_client, a2a_client, card)
        await sio.emit('client_initialized', {'status': 'success'}, to=sid)
    except Exception as e:
        await sio.emit(
            'client_initialized', {'status': 'error', 'message': str(e)}, to=sid
        )


@sio.on('send_message')
async def handle_send_message(sid: str, json_data: dict[str, Any]) -> None:
    """Handle the 'send_message' socket.io event."""
    message_text = json_data.get('message')
    message_id = json_data.get('id', str(uuid4()))

    if sid not in clients:
        await sio.emit(
            'agent_response',
            {'error': 'Client not initialized.', 'id': message_id},
            to=sid,
        )
        return

    _, a2a_client, card = clients[sid]

    message = Message(
        role=Role.user,
        parts=[TextPart(text=str(message_text))],
        messageId=str(uuid4()),
    )
    payload = MessageSendParams(
        message=message,
        configuration=MessageSendConfiguration(
            acceptedOutputModes=['text/plain', 'video/mp4']
        ),
    )

    supports_streaming = (
        hasattr(card.capabilities, 'streaming')
        and card.capabilities.streaming is True
    )

    try:
        if supports_streaming:
            request_obj = SendStreamingMessageRequest(
                id=message_id,
                method='message/stream',
                jsonrpc='2.0',
                params=payload,
            )
            await sio.emit(
                'debug_log',
                {
                    'type': 'request',
                    'data': request_obj.model_dump(exclude_none=True),
                    'id': message_id,
                },
                to=sid,
            )

            response_stream = a2a_client.send_message_streaming(request_obj)

            async for result in response_stream:
                if isinstance(result.root, JSONRPCErrorResponse):
                    error_data = result.root.error.model_dump(exclude_none=True)
                    await sio.emit(
                        'debug_log',
                        {'type': 'error', 'data': error_data, 'id': message_id},
                        to=sid,
                    )
                    await sio.emit(
                        'agent_response',
                        {
                            'error': error_data.get('message', 'Unknown error'),
                            'id': message_id,
                        },
                        to=sid,
                    )
                    continue

                event = result.root.result
                response_id = event.id if hasattr(event, 'id') else message_id

                response_data = event.model_dump(exclude_none=True)
                response_data['id'] = response_id

                validation_errors = validate_message(response_data)
                response_data['validation_errors'] = validation_errors

                await sio.emit(
                    'debug_log',
                    {
                        'type': 'response',
                        'data': response_data,
                        'id': response_id,
                    },
                    to=sid,
                )
                await sio.emit('agent_response', response_data, to=sid)
        else:
            request_obj = SendMessageRequest(
                id=message_id,
                method='message/send',
                jsonrpc='2.0',
                params=payload,
            )
            await sio.emit(
                'debug_log',
                {
                    'type': 'request',
                    'data': request_obj.model_dump(exclude_none=True),
                    'id': message_id,
                },
                to=sid,
            )

            result = await a2a_client.send_message(request_obj)

            if isinstance(result.root, JSONRPCErrorResponse):
                error_data = result.root.error.model_dump(exclude_none=True)
                await sio.emit(
                    'debug_log',
                    {'type': 'error', 'data': error_data, 'id': message_id},
                    to=sid,
                )
                await sio.emit(
                    'agent_response',
                    {
                        'error': error_data.get('message', 'Unknown error'),
                        'id': message_id,
                    },
                    to=sid,
                )
            else:
                event = result.root.result
                response_id = event.id if hasattr(event, 'id') else message_id

                response_data = event.model_dump(exclude_none=True)
                response_data['id'] = response_id

                validation_errors = validate_message(response_data)
                response_data['validation_errors'] = validation_errors

                await sio.emit(
                    'debug_log',
                    {
                        'type': 'response',
                        'data': response_data,
                        'id': response_id,
                    },
                    to=sid,
                )
                await sio.emit('agent_response', response_data, to=sid)

    except Exception as e:
        traceback.print_exc()
        await sio.emit(
            'agent_response',
            {'error': f'Failed to send message: {e}', 'id': message_id},
            to=sid,
        )


@sio.on('connect')
async def handle_connect(sid: str, environ: dict[str, Any]) -> None:
    """Handle the 'connect' socket.io event."""
    print(f'Client connected: {sid}, environment: {environ}')


@sio.on('disconnect')
async def handle_disconnect(sid: str) -> None:
    """Handle the 'disconnect' socket.io event."""
    print(f'Client disconnected: {sid}')
    if sid in clients:
        httpx_client, _, _ = clients.pop(sid)
        await httpx_client.aclose()
        print(f'Cleaned up client for {sid}')


if __name__ == '__main__':
    import uvicorn

    uvicorn.run('app:app', host='127.0.0.1', port=5001, reload=True)
