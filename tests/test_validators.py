import pytest

from backend import validators


# ==============================================================================
# Fixtures
# ==============================================================================


@pytest.fixture
def valid_card_data():
    """Fixture providing a valid agent card dictionary."""
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


# ==============================================================================
# Tests for validate_agent_card
# ==============================================================================


class TestValidateAgentCard:
    def test_valid_card(self, valid_card_data):
        """A valid agent card should produce no validation errors."""
        errors = validators.validate_agent_card(valid_card_data)
        assert len(errors) == 0

    def test_missing_required_field(self, valid_card_data):
        """A missing required field should be detected."""
        card_data = valid_card_data.copy()
        del card_data['name']
        errors = validators.validate_agent_card(card_data)
        assert "Required field is missing: 'name'." in errors

    def test_invalid_url(self, valid_card_data):
        """An invalid URL format should be detected."""
        card_data = valid_card_data.copy()
        card_data['url'] = 'ftp://invalid-url.com'
        errors = validators.validate_agent_card(card_data)
        assert (
            "Field 'url' must be an absolute URL starting with http:// or https://."
            in errors
        )


# ==============================================================================
# Tests for validate_message
# ==============================================================================


class TestValidateMessage:
    def test_missing_kind(self):
        """A message missing the 'kind' field should be detected."""
        errors = validators.validate_message({})
        assert "Response from agent is missing required 'kind' field." in errors

    def test_unknown_kind(self):
        """An unknown message kind should be detected."""
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
        ids=[
            'task-missing-status',
            'status-update-missing-state',
            'artifact-update-missing-artifact',
            'artifact-update-empty-parts',
            'message-empty-parts',
            'message-wrong-role',
        ],
    )
    def test_invalid_data(self, kind, data, expected_error):
        """Various invalid message structures should return the expected error."""
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
        ids=[
            'task-valid',
            'status-update-valid',
            'artifact-update-valid',
            'message-valid',
        ],
    )
    def test_valid_data(self, kind, data):
        """Various valid message structures should produce no errors."""
        full_data = {'kind': kind, **data}
        errors = validators.validate_message(full_data)
        assert len(errors) == 0
