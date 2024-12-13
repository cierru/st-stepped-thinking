# SillyTavern Extension Stepped Thinking

The extension is designed to provide [prompt chaining](https://www.promptingguide.ai/techniques/prompt_chaining) for SillyTavern. The general idea behind
it is to force an LLM to generate a character's thoughts (emotions, plans - whatever you wish) before running the
regular
prompt generation. This increases the overall waiting time for a response in favor of the quality of that response.

## Features

### Implemented

#### Thought Generation
1. An arbitrary number of user-defined prompts to generate a character’s thoughts before regular generation.
2. Configuring how many of the last character’s thoughts are included in a prompt.
3. Regenerating specific generated thoughts when necessary.
4. Removing extra symbols from thoughts using a customizable regular expression.
5. Hiding thoughts behind a spoiler to create intrigue, if desired.

#### Character-Specific Settings
1. Assigning custom prompt sets to specific characters.
2. Excluding specific characters from the thinking process.
3. Isolating thoughts from different characters in group chats by default.
4. Allowing certain characters to read the thoughts of other characters in group chats.

### Planned

1. "On-Click" mode for generating thoughts.
2. Presets for thinking prompts.
3. Using a different API for generating thoughts.
4. Localization in Russian.

You can find a more detailed roadmap in the wiki by following [this link](https://github.com/cierru/st-stepped-thinking/wiki/Roadmap).
Before proposing a feature, please make sure that the feature is not already listed in the roadmap.

## Installation and Usage

### Installation

Just open the `Extensions` menu in SillyTavern, then click on the `Install Extension` button.

After that, you may paste the url of this repository to install the
extension: https://github.com/cierru/st-stepped-thinking

**Upgrading Notice:** The guidelines below describe the new "Embedded" (or "Embedded Thoughts") mode, which can be selected in the
settings section and is set as the default for new installations. If you have updated Stepped Thinking from version 2 or
earlier, your mode will remain "Separated," the old mode that is still included in the extension for backward
compatibility. Please note that after upgrading, you will need to assign names to your thinking prompts manually. The
"Separated" mode is considered deprecated and will not receive updates in the future. The modes are mutually
incompatible; therefore, the golden rule is: **one mode = one chat.**

### Usage

1. Install the extension.
2. Open a chat (solo or group) and send your message.
3. You will see:
    1. An element containing a spoiler with the header "CharacterName's thoughts".
    2. A popup notifying you that the character is thinking.
4. Wait until a popup with the text "Done!" raises.
5. The generation of a new message for the same character will be launched automatically.

There is an example of how the result may look like:

![sample_dialog](https://github.com/user-attachments/assets/033532f9-81b0-4082-88ed-9955b62dc83a)

### Settings

You can find the extension settings in the `Stepped Thinking` section of the SillyTavern `Extensions` menu.

#### Character-Specific Settings

You can access personal character settings via the bubble icon to the left of the star. The
icon is white by default, but when the setting is active, it turns green.

![character_settings](https://github.com/user-attachments/assets/f6839807-733d-4abe-91f7-c28cbf336716)

These settings will override the general ones when active. For example, you can disable Stepped Thinking activation for
a particular character or use specific thinking prompts for them. If the `Prompts for thinking` section is empty in the
character's settings, the general prompts will be used.

![character_settings_popup](https://github.com/user-attachments/assets/133a8f71-4f7c-41ce-b23a-4a06150d1f8a)

Click `Activate` to apply the specified settings, or `Deactivate` to disable them and use the general ones instead. You
can find the full list of active character settings in the regular Stepped Thinking settings menu under the `Character
Settings` block.

### Slash commands

#### /stepthink-trigger

This command is designed to manually trigger the thought generation process. It accepts two optional arguments:

1. `prompt_ids` – the comma-separated IDs of thinking prompts that will be used for generation. Currently, the only way
   to extract the IDs is by looking through the `st-stepped-thinking` section in the `settings.json` file, which is
   typically located at `SillyTavern\data\default-user`. The prompt IDs will be exposed in the extension settings
   section in future updates.

   **Note:** The default IDs are `0` for thoughts and `1` for plans.
2. The name of the character for whom the process will be launched, which is particularly useful for group chats.

**Examples:**

- `/stepthink-trigger` — triggers thought generation for your companion in solo chats.
- `/stepthink-trigger Seraphina` — triggers thought generation for Seraphina.
- `/stepthink-trigger prompt_ids=0,1 Seraphina` - trigger thought generation using prompts with IDs `0` and `1` for
  Seraphina.

#### /stepthink-delete-hidden

This command is intended to purge your chat of hidden thoughts. It also accepts one optional argument - the name
of the character whose thoughts will be removed.  
**Be cautious:** This action cannot be undone!

**Examples:**

- `/stepthink-delete-hidden` — removes all hidden thoughts in the current chat.
- `/stepthink-delete-hidden Seraphina` — removes all hidden thoughts belonging to Seraphina in the current chat.

### Enhancing your experience

Visit [the wiki](https://github.com/cierru/st-stepped-thinking/wiki) for various useful pages, such as:

1. [Community-suggested thinking prompts](https://github.com/cierru/st-stepped-thinking/wiki/Prompts-for-thinking).
2. Instructions
   for [creating a button to trigger thoughts generation](https://github.com/cierru/st-stepped-thinking/wiki/Creating-a-button-to-generate-thoughts-on-demand)
   on demand.

If you want to share your thinking prompts, injection templates, usage experience with different models, or any other
experiences, you are most welcome to do so in one of the following ways:

* Write a comment with your suggestions in the dedicated [issue](https://github.com/cierru/st-stepped-thinking/issues/11).
* Send a message to [the Discord channel](https://discord.com/channels/1100685673633153084/1295009159225282580) devoted
  to Stepped Thinking.

## Prerequisites

The extension has been tested on SillyTavern 1.12.11+ and may not work with older versions.

## Support and Contributions

You are always welcome to contribute to this project. You may create issues, pull requests,
and describe them in English or Russian - whatever is more convenient for you. If you want to implement something that
is outside the scope of [the roadmap](https://github.com/cierru/st-stepped-thinking/wiki/Roadmap), please create an issue and have the feature approved by the owner.

Special credits to the anon from the /llama thread who described the idea and wrote a PoC of the approach that formed
the basis of this extension. You can familiarize yourself with the results of his efforts
here: https://rentry.co/LLMCrutches

## License

MIT License

Copyright (c) 2024 cierru
