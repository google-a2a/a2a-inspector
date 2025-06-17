## A2A Protocol Inspector
The A2A Inspector is a web-based tool designed to help developers inspect, debug, and validate servers that implement the Google A2A (Agent-to-Agent) protocol. It provides a user-friendly interface to interact with an A2A agent, view communication, and ensure specification compliance.

The application is built with FastAPI and uses Socket.IO for real-time communication.

### Features
* Connect to a local A2A Agent: Specify the base URL of any agent server to connect (e.g. http://localhost:5555).
* View Agent Card: Automatically fetches and displays the agent's card.
* Spec Compliance Checks: Performs basic validation on the agent card to ensure it adheres to the A2A specification.
* Messages: A chat interface to send and receive text messages with the connected agent.
* Debug  Console: A slide-out console at the bottom of the screen shows the raw JSON-RPC 2.0 messages sent and received between the inspector and the agent server.


### Prerequisites
Python 3.10+
uv
Node.js and npm

### Setup and Installation
Follow these steps to get the A2A Inspector running on your local machine.

cd a2a-inspector

#### Install Dependencies
Install all required packages from the requirements.txt file using uv.

uv pip install -r requirements.txt

From the inspector folder, run:
npm install

#### Running the Application
##### Build the frontend.
npm run build

uv run app.py


#### Access the Inspector
Open your web browser and navigate to:
http://127.0.0.1:5001