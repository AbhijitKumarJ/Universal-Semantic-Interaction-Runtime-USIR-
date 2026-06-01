# Turn 11 — USIR

> **USIR responded:**

**Defining the Interaction**

I'm currently focused on defining the interaction flow itself. The aim is a truly versatile XML template. I'm prioritizing device, channel, and interface independence. Waypoints and supported modalities (like audio) are at the forefront as core elements. It's about crafting the essence of the interaction.


**Structuring the Framework**

I'm now detailing the XML structure. Key elements include the root `<InteractionWaypoint>`, metadata like `id` and `context`, and dedicated sections for `<Presentations>` and `<Inputs>`. The `<Presentations>` will be the core of supporting multiple modality and medium-based experiences, and the `<Inputs>` define how to handle expected responses. I'm focusing on `<Display>`, `<Audio>`, and `<Haptic>` options as well as specifying intents, button mappings and gestures.


**Refining the XML Elements**

I'm now diving deeper into how to handle input. I'm expanding the XML structure with a focus on capturing different input methods. I've designed sections for Voice, Touch, and Gesture inputs. I'm specifying intents for voice, actions for touch, and types for gestures. These will integrate seamlessly with the presentations I've detailed earlier. I am building out the structure of those presentations, so the system is fully multi-modal.




Here is a universal XML template definition designed for ambient, cross-modality interaction. It separates the **logic/intent** from the **presentation** and **input mechanisms**.

```xml
<InteractionWaypoint id="bmad_step_1_diverge">
    
    <!-- Central Logic & Context -->
    <Context>
        <State>brainstorming_ideation</State>
        <Objective>Gather initial unfiltered ideas</Objective>
    </Context>

    <!-- Output: How the device presents the waypoint -->
    <Presentations>
        <!-- For Mobile/Web/Smartwatch screens -->
        <Display layout="wizard_list">
            <Prompt>State your first idea:</Prompt>
            <Option id="skip">Skip for now</Option>
        </Display>

        <!-- For XR Glasses/Spatial computing -->
        <Spatial layout="floating_panel" position="center_eye_level">
            <Prompt3D>State your first idea</Prompt3D>
            <HoloButton id="skip">Skip</HoloButton>
        </Spatial>

        <!-- For Earbuds/Smart Speakers/Voice-only -->
        <Audio>
            <TTS>What is your first idea? You can speak naturally, or say skip.</TTS>
            <Earcon type="listening_start_beep" />
        </Audio>

        <!-- For Watch/Wearable haptics -->
        <Haptic pattern="attention_double_tap" />
    </Presentations>

    <!-- Input: How the user can respond based on their device -->
    <ExpectedInputs>
        <Voice>
            <Intent action="submit_idea" capture="wildcard" />
            <Intent action="trigger_skip">skip, pass, next</Intent>
        </Voice>
        
        <Touch>
            <Event target="skip" action="trigger_skip" />
            <Event target="text_input" action="submit_idea" />
        </Touch>
        
        <Gesture>
            <!-- For XR or Watch micro-gestures -->
            <Action type="pinch" target="skip" action="trigger_skip" />
            <Action type="nod" action="confirm_listening" />
        </Gesture>
    </ExpectedInputs>

</InteractionWaypoint>
```

### Why this works:
1. **Agnostic Payload:** The server sends this single XML block.
2. **Client-Side Rendering:** A smartwatch parses `<Audio>`, `<Haptic>`, and `<Voice>`. XR glasses parse `<Spatial>` and `<Gesture>`. A web browser parses `<Display>` and `<Touch>`.
3. **Unified Backend:** No matter how the user replies (pinch, voice, or click), the client sends back a standard action (e.g., `action="submit_idea"`), keeping the server completely decoupled from the hardware.