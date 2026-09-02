import asyncio
import pytest
from app.services.tool_service import ToolService
from app.services.interruption_manager import InterruptionManager
from app.models.travel import SearchTrainsResult


@pytest.mark.asyncio
async def test_successful_tool_execution():
    """
    Test 1: Successful tool execution
    Verifies that search_trains runs asynchronously, returns realistic demo trains,
    attaches a unique request_id, and tags the result with the correct generation_id.
    """
    # Run with a short delay for quick test execution
    result: SearchTrainsResult = await ToolService.search_trains(
        origin="Kolkata",
        destination="Delhi",
        date="tomorrow",
        time_constraint="evening",
        generation_id="gen_1",
        delay_seconds=0.05,
    )

    assert result is not None
    assert result.request_id.startswith("req_")
    assert result.generation_id == "gen_1"
    assert result.origin == "Kolkata"
    assert result.destination == "Delhi"
    assert result.is_cancelled is False
    assert result.is_stale is False
    assert len(result.trains) > 0
    # Verify evening trains are returned
    for train in result.trains:
        assert train.departure_time_type == "evening"
    assert any("Rajdhani" in t.name for t in result.trains)


@pytest.mark.asyncio
async def test_tool_cancellation():
    """
    Test 2: Tool cancellation
    Verifies that an in-flight tool execution task can be cancelled cleanly
    when a barge-in interruption occurs.
    """
    coro = ToolService.search_trains(
        origin="Kolkata",
        destination="Delhi",
        date="tomorrow",
        generation_id="gen_1",
        delay_seconds=2.0,  # simulate 2s task
    )
    task = asyncio.create_task(coro)

    # Allow task to start running
    await asyncio.sleep(0.05)
    assert not task.done()

    # Cancel task simulating user interruption
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task

    assert task.cancelled()


@pytest.mark.asyncio
async def test_stale_result_protection():
    """
    Test 3: Stale result protection
    Verifies that if a tool result from an obsolete generation (e.g. gen_1)
    completes or arrives AFTER a new generation (gen_2) has been registered,
    the InterruptionManager identifies it as stale and prevents it from updating state.
    """
    manager = InterruptionManager()
    session_id = "test_session_stale"

    # Start generation 1
    manager.register_new_generation(session_id, "gen_1")
    assert manager.get_current_generation(session_id) == "gen_1"

    # Spawn mock tool result for generation 1
    mock_gen1_result = SearchTrainsResult(
        request_id="req_old123",
        generation_id="gen_1",
        origin="Kolkata",
        destination="Delhi",
        date="tomorrow",
        time_constraint="morning",
        trains=[],
        is_cancelled=False,
        is_stale=False,
        execution_time_ms=100,
    )

    # While gen_1 is in flight, user interrupts and advances epoch to gen_2
    manager.register_new_generation(session_id, "gen_2")
    assert manager.get_current_generation(session_id) == "gen_2"

    # Now old gen_1 result arrives at the state barrier
    safe_result = manager.process_tool_result(session_id, mock_gen1_result)

    # MUST be None: stale result is dropped!
    assert safe_result is None
    assert mock_gen1_result.is_stale is True
    assert manager.get_stale_drop_count(session_id) == 1

    # In contrast, a fresh gen_2 result is permitted
    mock_gen2_result = SearchTrainsResult(
        request_id="req_fresh456",
        generation_id="gen_2",
        origin="Kolkata",
        destination="Delhi",
        date="tomorrow",
        time_constraint="evening",
        trains=[],
        is_cancelled=False,
        is_stale=False,
        execution_time_ms=50,
    )
    safe_gen2_result = manager.process_tool_result(session_id, mock_gen2_result)
    assert safe_gen2_result is not None
    assert safe_gen2_result.generation_id == "gen_2"
    assert safe_gen2_result.is_stale is False


@pytest.mark.asyncio
async def test_tool_timeout():
    """
    Test 4: Tool timeout handling
    Verifies that if a tool execution exceeds a maximum allowable threshold,
    it raises a TimeoutError and does not hang the event loop.
    """
    coro = ToolService.search_trains(
        origin="Kolkata",
        destination="Delhi",
        date="tomorrow",
        generation_id="gen_1",
        delay_seconds=1.0,
    )

    # Impose a strict 0.05s timeout
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(coro, timeout=0.05)
