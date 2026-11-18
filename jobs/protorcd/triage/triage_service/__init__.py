"""WebSocket triage service around the frozen ProtoRCD triage core.

HTTP (with OpenAPI docs at ``/docs``) manages datasets, sessions, crops and exports; the
human-in-the-loop label exchange runs over ``/ws/sessions/{session_id}``. The triage
algorithm itself is ``protorcd_pipeline.triage`` + ``serving.session_manager``, copied
unchanged from ProtoRCD.
"""
