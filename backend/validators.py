def validate_agent_card(card_data: dict):
    errors = []
    
    # Define required fields based on the documentation
    required_fields = [
        "name", "description", "url", "version", "capabilities", 
        "defaultInputModes", "defaultOutputModes", "skills"
    ]

    # Check for the presence of all required fields
    for field in required_fields:
        if field not in card_data:
            errors.append(f"Required field is missing: '{field}'.")

    # Check if 'url' is an absolute URL (basic check)
    if 'url' in card_data and not (card_data['url'].startswith('http://') or card_data['url'].startswith('https://')):
         errors.append("Field 'url' must be an absolute URL starting with http:// or https://.")

    # Check if capabilities is a dictionary
    if 'capabilities' in card_data and not isinstance(card_data['capabilities'], dict):
        errors.append("Field 'capabilities' must be an object.")
        
    # Check if defaultInputModes and defaultOutputModes are arrays of strings
    for field in ["defaultInputModes", "defaultOutputModes"]:
        if field in card_data:
            if not isinstance(card_data[field], list):
                errors.append(f"Field '{field}' must be an array of strings.")
            elif not all(isinstance(item, str) for item in card_data[field]):
                 errors.append(f"All items in '{field}' must be strings.")

    # Check skills array
    if 'skills' in card_data:
        if not isinstance(card_data['skills'], list):
            errors.append("Field 'skills' must be an array of AgentSkill objects.")
        elif len(card_data['skills']) == 0:
            errors.append("Field 'skills' array is empty. Agent must have at least one skill if it performs actions.")

    return errors

def _validate_task(data):
    errors = []
    if 'id' not in data:
        errors.append("Task object missing required field: 'id'.")
    if 'status' not in data or 'state' not in data['status']:
        errors.append("Task object missing required field: 'status.state'.")
    return errors

def _validate_status_update(data):
    errors = []
    if 'status' not in data or 'state' not in data['status']:
        errors.append("StatusUpdate object missing required field: 'status.state'.")
    return errors

def _validate_artifact_update(data):
    errors = []
    if 'artifact' not in data:
        errors.append("ArtifactUpdate object missing required field: 'artifact'.")
    elif 'parts' not in data['artifact'] or not isinstance(data['artifact']['parts'], list) or not data['artifact']['parts']:
        errors.append("Artifact object must have a non-empty 'parts' array.")
    return errors

def _validate_message(data):
    errors = []
    if 'parts' not in data or not isinstance(data['parts'], list) or not data['parts']:
        errors.append("Message object must have a non-empty 'parts' array.")
    if 'role' not in data or data['role'] != 'agent':
        errors.append("Message from agent must have 'role' set to 'agent'.")
    return errors

def validate_message(data: dict):
    if 'kind' not in data:
        return ["Response from agent is missing required 'kind' field."]

    kind = data.get('kind')
    validators = {
        'task': _validate_task,
        'status-update': _validate_status_update,
        'artifact-update': _validate_artifact_update,
        'message': _validate_message,
    }

    validator = validators.get(kind)
    if validator:
        return validator(data)
    
    return [f"Unknown message kind received: '{kind}'."]