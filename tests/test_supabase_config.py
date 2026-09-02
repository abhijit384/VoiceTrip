import pytest
from app.core.config import settings
from app.core.supabase import SupabaseService


def test_supabase_config_variable_names():
    """Verifies new Supabase variables are present and old ones are removed."""
    # New variables MUST exist
    assert hasattr(settings, "SUPABASE_URL")
    assert hasattr(settings, "SUPABASE_PUBLISHABLE_KEY")
    assert hasattr(settings, "SUPABASE_SECRET_KEY")

    # Old variables MUST NOT exist on settings
    assert not hasattr(settings, "SUPABASE_ANON_KEY")
    assert not hasattr(settings, "SUPABASE_SERVICE_ROLE_KEY")


def test_supabase_service_initialization():
    """Verifies SupabaseService initializes cleanly without error."""
    service = SupabaseService()
    assert service.url == settings.SUPABASE_URL
    assert service.publishable_key == settings.SUPABASE_PUBLISHABLE_KEY
    assert service.secret_key == settings.SUPABASE_SECRET_KEY
    # If not configured with live credentials, get_server_client returns None safely
    assert service.get_server_client() is None
