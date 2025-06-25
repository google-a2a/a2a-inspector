import pytest

from backend import validators


# ==============================================================================
# Tests for validate_agent_card
# ==============================================================================


def get_valid_card_data():
    """Returns a dictionary representing a valid agent card."""
    return {
        'name': 'Test Agent',
        'description': 'An agent for testing.',
        'url': 'https://example.com/agent',
        'version': '1.0.0',
        'capabilities': {'streaming': True},
        'defaultInputModes': ['text/plain'],
        'defaultOutputModes': ['text/plain'],
        'skills': [{'name': 'test_skill'}],
    }


def test_validate_agent_card_valid():
    """Tests that a valid agent card produces no validation errors."""
    card_data = get_valid_card_data()
    errors = validators.validate_agent_card(card_data)
    assert not errors


def test_validate_agent_card_missing_required_field():
    """Tests that a missing required field is detected."""
    card_data = get_valid_card_data()
    del card_data['name']
    errors = validators.validate_agent_card(card_data)
    assert "Required field is missing: 'name'." in errors


def test_validate_agent_card_invalid_url():
    """Tests that an invalid URL format is detected."""
    card_data = get_valid_card_data()
    card_data['url'] = 'ftp://invalid-url.com'
    errors = validators.validate_agent_card(card_data)
    assert (
        "Field 'url' must be an absolute URL starting with http:// or https://."
        in errors
    )


# ==============================================================================
# Tests for validate_message
# ==============================================================================


def test_validate_message_missing_kind():
    """Tests that a message missing the 'kind' field is detected."""
    errors = validators.validate_message({})
    assert "Response from agent is missing required 'kind' field." in errors


def test_validate_message_unknown_kind():
    """Tests that an unknown message kind is detected."""
    errors = validators.validate_message({'kind': 'unknown-kind'})
    assert "Unknown message kind received: 'unknown-kind'." in errors


@pytest.mark.parametrize(
    'kind, data, expected_error',
    [
        (
            'task',
            {'id': '123'},
            "Task object missing required field: 'status.state'.",
        ),
        (
            'status-update',
            {'status': {}},
            "StatusUpdate object missing required field: 'status.state'.",
        ),
        (
            'artifact-update',
            {},
            "ArtifactUpdate object missing required field: 'artifact'.",
        ),
        (
            'artifact-update',
            {'artifact': {}},
            "Artifact object must have a non-empty 'parts' array.",
        ),
        (
            'message',
            {'parts': []},
            "Message object must have a non-empty 'parts' array.",
        ),
        (
            'message',
            {'parts': [{'text': 'hi'}], 'role': 'user'},
            "Message from agent must have 'role' set to 'agent'.",
        ),
    ],
)
def test_validate_message_invalid_data(kind, data, expected_error):
    """Tests various invalid message structures based on their kind."""
    full_data = {'kind': kind, **data}
    errors = validators.validate_message(full_data)
    assert expected_error in errors


@pytest.mark.parametrize(
    'kind, data',
    [
        ('task', {'id': '123', 'status': {'state': 'running'}}),
        ('status-update', {'status': {'state': 'thinking'}}),
        ('artifact-update', {'artifact': {'parts': [{'text': 'result'}]}}),
        ('message', {'parts': [{'text': 'hello'}], 'role': 'agent'}),
    ],
)
def test_validate_message_valid_data(kind, data):
    """Tests various valid message structures to ensure no errors are returned."""
    full_data = {'kind': kind, **data}
    errors = validators.validate_message(full_data)
    assert not errors
