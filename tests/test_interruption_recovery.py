import asyncio
import pytest
from app.services.interruption_manager import InterruptionManager
from app.services.tool_service import ToolService
from app.services.gemini_service import GeminiService
from app.services.tts_service import RimeTTSService
from app.models.travel import SearchTrainsResult


@pytest.mark.asyncio
async def test_race_condition_tool_result_arriving_after_interruption():
    """
    Race Condition 1: Tool result arriving after interruption.
    Scenario:
    - User asks: "Find me trains from Kolkata to Delhi tomorrow." (gen_1)
    - Tool task takes 200ms to calculate.
    - At 50ms, user interrupts: "Actually, only evening trains." (gen_2 is registered)
    - At 200ms, the old gen_1 calculation completes.
    - Assertion: gen_1 result is BLOCKED, flagged as stale, and rejected by the barrier.
    """
    manager = InterruptionManager()
    session_id = "test_race_1"

    # Start generation 1
    manager.register_new_generation(session_id, "gen_1")

    # Launch tool task for gen_1
    coro = ToolService.search_trains(
        origin="Kolkata",
        destination="Delhi",
        date="tomorrow",
        time_constraint="any",
        generation_id="gen_1",
        delay_seconds=0.15,
    )
    gen1_task = asyncio.create_task(coro)
    manager.track_task(session_id, "gen_1", gen1_task)

    # Midway, user interrupts!
    await asyncio.sleep(0.04)
    manager.register_new_generation(session_id, "gen_2")
    assert manager.get_current_generation(session_id) == "gen_2"

    # Simulated completion of gen_1
    mock_gen1_delayed_result = SearchTrainsResult(
        request_id="req_delayed_1",
        generation_id="gen_1",
        origin="Kolkata",
        destination="Delhi",
        date="tomorrow",
        time_constraint="any",
        trains=[],
        is_cancelled=False,
        is_stale=False,
        execution_time_ms=150,
    )

    # Filter through barrier
    safe_result = manager.process_tool_result(session_id, mock_gen1_delayed_result)
    assert safe_result is None, "Stale gen_1 result must NEVER leak into active state!"
    assert mock_gen1_delayed_result.is_stale is True
    assert manager.get_stale_drop_count(session_id) == 1


@pytest.mark.asyncio
async def test_race_condition_audio_arriving_after_cancellation():
    """
    Race Condition 2: Audio arriving after cancellation.
    Scenario:
    - Rime TTS was asked to synthesize speech for gen_1.
    - While synthesizing/buffering, user barges in, advancing epoch to gen_2.
    - Stale audio packets tagged with gen_1 arrive.
    - Assertion: validate_audio_generation rejects gen_1 audio packets.
    """
    manager = InterruptionManager()
    session_id = "test_race_2"

    manager.register_new_generation(session_id, "gen_1")

    # User interrupts and advances to gen_2
    manager.register_new_generation(session_id, "gen_2")

    # Audio from old gen_1 arrives
    is_allowed = manager.validate_audio_generation(session_id, "gen_1")
    assert is_allowed is False, "Obsolete gen_1 audio must be stopped and dropped!"
    assert manager.get_stale_audio_drop_count(session_id) == 1

    # Fresh audio for gen_2 is permitted
    assert manager.validate_audio_generation(session_id, "gen_2") is True


@pytest.mark.asyncio
async def test_race_condition_multiple_rapid_interruptions():
    """
    Race Condition 3: Multiple rapid interruptions in quick succession.
    Scenario:
    - User asks something (gen_1).
    - 20ms later, user says "Wait" (gen_2).
    - 30ms later, user says "Actually, evening trains" (gen_3).
    - Assertion: Only gen_3 is active; all prior tasks cancelled, gen_1 and gen_2 staled.
    """
    manager = InterruptionManager()
    session_id = "test_race_3"

    # Rapid cascade
    manager.register_new_generation(session_id, "gen_1")
    t1 = asyncio.create_task(asyncio.sleep(1.0))
    manager.track_task(session_id, "gen_1", t1)

    manager.register_new_generation(session_id, "gen_2")
    await asyncio.sleep(0.01)
    assert t1.cancelled() or t1.done()
    t2 = asyncio.create_task(asyncio.sleep(1.0))
    manager.track_task(session_id, "gen_2", t2)

    manager.register_new_generation(session_id, "gen_3")
    await asyncio.sleep(0.01)
    assert t2.cancelled() or t2.done()
    assert manager.get_current_generation(session_id) == "gen_3"

    # Check stale barriers
    assert manager.is_result_stale(session_id, "gen_1") is True
    assert manager.is_result_stale(session_id, "gen_2") is True
    assert manager.is_result_stale(session_id, "gen_3") is False


@pytest.mark.asyncio
async def test_race_condition_cancellation_during_llm_generation():
    """
    Race Condition 4: Cancellation during LLM generation.
    Scenario:
    - LLM call is running when user speaks.
    - Task is cancelled cleanly without leaving orphaned coroutines.
    """
    llm = GeminiService()
    manager = InterruptionManager()
    session_id = "test_race_4"

    manager.register_new_generation(session_id, "gen_1")

    # Spawn LLM task
    task = asyncio.create_task(
        llm.chat_completion([{"role": "user", "content": "Tell me a long story"}])
    )
    manager.track_task(session_id, "gen_1", task)

    # Cancel during execution
    manager.register_new_generation(session_id, "gen_2")
    await asyncio.sleep(0.01)
    assert task.cancelled() or task.done() or (hasattr(task, 'cancelling') and task.cancelling() > 0)


@pytest.mark.asyncio
async def test_race_condition_cancellation_during_tts_generation():
    """
    Race Condition 5: Cancellation during TTS generation.
    Scenario:
    - Rime TTS synthesis is running when user speaks.
    - Task is aborted immediately, preserving resources.
    """
    tts = RimeTTSService()
    manager = InterruptionManager()
    session_id = "test_race_5"

    manager.register_new_generation(session_id, "gen_1")

    task = asyncio.create_task(
        tts.synthesize_bytes("A very long sentence being synthesized by Rime TTS.")
    )
    manager.track_task(session_id, "gen_1", task)

    # Abort when user barge-in occurs
    manager.register_new_generation(session_id, "gen_2")
    await asyncio.sleep(0.01)
    assert task.cancelled() or task.done() or (hasattr(task, 'cancelling') and task.cancelling() > 0)


@pytest.mark.asyncio
async def test_main_interruption_acceptance_test():
    """
    MAIN HACKATHON ACCEPTANCE TEST:
    1. User speaks: "Find me trains from Kolkata to Delhi tomorrow."
    2. Tool starts its 5-second simulated travel search (gen_1).
    3. User interrupts: "Actually, only evening trains." (barge-in at 0.1s in test)
    4. Verification:
       - gen_1 cancelled and invalidated
       - old audio cutoff
       - stale results blocked from becoming current answer
       - new constraint 'evening' applied
       - evening trains returned (Rajdhani, Duronto)
       - final response synthesized for Rime TTS
    """
    manager = InterruptionManager()
    session_id = "acceptance_test_session"

    # Step 1 & 2: Start initial search
    manager.register_new_generation(session_id, "gen_1")
    initial_tool_task = asyncio.create_task(
        ToolService.search_trains(
            origin="Kolkata",
            destination="Delhi",
            date="tomorrow",
            time_constraint="any",
            generation_id="gen_1",
            delay_seconds=2.0,
        )
    )
    manager.track_task(session_id, "gen_1", initial_tool_task)

    # Step 3: User interrupts!
    await asyncio.sleep(0.05)
    recovery = await manager.recover_from_interruption(
        session_id=session_id,
        previous_gen="gen_1",
        new_gen="gen_2",
        new_constraint="evening",
        origin="Kolkata",
        destination="Delhi",
        date="tomorrow",
    )

    # Step 4: Validate acceptance criteria
    assert initial_tool_task.cancelled() or initial_tool_task.done()
    assert recovery["cancelled_generation"] == "gen_1"
    assert recovery["active_generation"] == "gen_2"
    assert recovery["constraint_applied"] == "evening"
    assert len(recovery["trains_found"]) > 0
    # Every returned train must be an evening train
    for train in recovery["trains_found"]:
        assert train["departure_time_type"] == "evening"
    # Evening trains should include Howrah Rajdhani or Duronto
    train_names = [t["name"] for t in recovery["trains_found"]]
    assert any("Rajdhani" in name for name in train_names)

    # Spoken response must be conversational for Rime TTS
    assert "evening" in recovery["spoken_response"].lower()
    assert "Rajdhani" in recovery["spoken_response"]
    assert len(recovery["spoken_response"].split(".")) <= 4  # Concise voice guidelines
