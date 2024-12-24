import {
    addOneMessage,
    event_types,
    eventSource,
    extension_prompt_roles,
    extension_prompt_types,
    extension_prompts,
    extractMessageBias,
    removeMacros,
    saveChatConditional,
    scrollChatToBottom,
    setExtensionPrompt,
    updateMessageBlock,
} from '../../../../../script.js';
import { getCurrentCharacterSettings, thinkingEvents } from './engine.js';
import { getContext } from '../../../../extensions.js';
import { settings, thoughtPrefixInjectionModes } from '../settings/settings.js';
import { hideChatMessageRange } from '../../../../chats.js';
import { getMessageTimeStamp } from '../../../../RossAscends-mods.js';
import { extensionName } from '../index.js';
import { uuidv4 } from '../../../../utils.js';
import { power_user } from '../../../../power-user.js';
import { names_behavior_types } from '../../../../instruct-mode.js';

/**
 * @typedef {object} ThoughtsStrategy
 * @property {function(): Promise<void>} hideThoughts
 * @property {function(OnSendThoughtsTemplateEvent): Promise<void>} sendCharacterTemplateMessage
 * @property {function(OnPutThoughtsEvent): Promise<void>} putCharacterThoughts
 * @property {function(OnSaveThoughtsEvent): Promise<void>} saveCharacterThoughts
 * @property {function(OnRenderThoughtsEvent): Promise<void>} renderCharacterThoughts
 * @property {function(): void} makeIntermediateThoughtsOrphans
 * @property {function(): void} removeOrphanThoughts
 * @property {function(): Promise<void>} prepareGenerationPrompt
 */
/**
 * @type {ThoughtsStrategy}
 */
let currentStrategy;

export const LAST_THOUGHT_ID = 'last';

export function switchToSeparatedThoughts() {
    currentStrategy = SeparatedThoughtsStrategy.getInstance();
}

export function switchToEmbeddedThoughts() {
    currentStrategy = EmbeddedThoughtsStrategy.getInstance();
}

export function registerThinkingListeners() {
    eventSource.on(
        thinkingEvents.ON_HIDE,
        preventDefaultDecorator(async () => currentStrategy.hideThoughts()),
    );
    eventSource.on(
        thinkingEvents.ON_SEND_TEMPLATE,
        preventDefaultDecorator(async (event) => currentStrategy.sendCharacterTemplateMessage(event)),
    );
    eventSource.on(
        thinkingEvents.ON_PUT,
        preventDefaultDecorator(async (event) => currentStrategy.putCharacterThoughts(event)),
    );
    eventSource.on(
        thinkingEvents.ON_SAVE,
        preventDefaultDecorator(async (event) => currentStrategy.saveCharacterThoughts(event)),
    );
    eventSource.on(
        thinkingEvents.ON_RENDER,
        preventDefaultDecorator(async (event) => currentStrategy.renderCharacterThoughts(event)),
    );
    eventSource.on(
        thinkingEvents.ON_MAKE_ORPHANS,
        preventDefaultDecorator(async () => currentStrategy.makeIntermediateThoughtsOrphans()),
    );
    eventSource.on(
        thinkingEvents.ON_REMOVE_ORPHANS,
        preventDefaultDecorator(async () => currentStrategy.removeOrphanThoughts()),
    );
    eventSource.on(
        thinkingEvents.ON_PREPARE_GENERATION,
        preventDefaultDecorator(async () => currentStrategy.prepareGenerationPrompt()),
    );
}

/**
 * @param {function(ThinkingEvent): Promise|void} handler
 * @return {function(ThinkingEvent): void}
 */
function preventDefaultDecorator(handler) {
    return async function (event) {
        if (event.defaultPrevented) {
            return;
        }

        const result = handler(event);
        if (result instanceof Promise) {
            await result;
        }
    };
}

/**
 * @implements {ThoughtsStrategy}
 */
class SeparatedThoughtsStrategy {
    /**
     * @var {SeparatedThoughtsStrategy}
     */
    static #instance;

    static getInstance() {
        if (!SeparatedThoughtsStrategy.#instance) {
            SeparatedThoughtsStrategy.#instance = new SeparatedThoughtsStrategy();
        }

        return SeparatedThoughtsStrategy.#instance;
    }

    /**
     * @return {Promise<void>}
     */
    async hideThoughts() {
        const context = getContext();
        const maxThoughts = settings.max_thoughts_in_prompt;

        const currentCharacter = context.characters[context.characterId];
        const characterSettings = getCurrentCharacterSettings();

        const isMindReaderCharacter = Boolean(characterSettings && characterSettings.is_mind_reader);
        const hasAccessToThought = (chatThoughtName) => isMindReaderCharacter || chatThoughtName === currentCharacter.name;

        let promises = [];
        const lastMessageIndex = context.chat.length - 1;
        for (let i = lastMessageIndex, thoughtsCount = []; i >= 0 && (lastMessageIndex - i < settings.max_hiding_thoughts_lookup); i--) {
            if (Boolean(context.chat[i]?.is_thoughts)) {
                const chatThoughtName = context.chat[i].thoughts_for || context.chat[i].name;
                thoughtsCount[chatThoughtName] ??= 0;
                if (thoughtsCount[chatThoughtName] < maxThoughts && hasAccessToThought(chatThoughtName)) {
                    promises.push(hideChatMessageRange(i, i, true));
                } else {
                    promises.push(hideChatMessageRange(i, i, false));
                }

                thoughtsCount[chatThoughtName]++;
            }
        }

        await Promise.all(promises);
    }

    /**
     * @param {OnSendThoughtsTemplateEvent} event
     * @return {Promise<void>}
     */
    async sendCharacterTemplateMessage(event) {
        const context = getContext();
        const openState = settings.is_thoughts_spoiler_open ? 'open' : '';

        const thoughtsMessage = settings.thoughts_message_template
            .replace('{{thoughts_spoiler_open_state}}', openState)
            .replace('{{thoughts_placeholder}}', this.#replaceThoughtsPlaceholder(settings.thoughts_placeholder.default_content));

        event.thoughtsMessageId = await this.#sendCharacterThoughts(
            context.characters[context.characterId],
            thoughtsMessage,
        );
    }

    /**
     * @param {OnPutThoughtsEvent} event
     * @return {Promise<void>}
     */
    async putCharacterThoughts(event) {
        const context = getContext();
        if (!context.chat[event.thoughtsMessageId]) {
            toastr.error('The message was not found at position ' + event.thoughtsMessageId + ', cannot insert thoughts. ' + 'Probably, the error was caused by unexpected changes in the chat.', 'Stepped Thinking', { timeOut: 10000 });
            return;
        }
        const message = context.chat[event.thoughtsMessageId];
        const defaultPlaceholder = this.#replaceThoughtsPlaceholder(settings.thoughts_placeholder.default_content);

        const isFirstThought = (message) => message.mes.search(defaultPlaceholder) !== -1;

        if (isFirstThought(message)) {
            message.mes = message.mes.replace(defaultPlaceholder, this.#replaceThoughtsPlaceholder(event.thought));
        } else {
            const lastThoughtEndIndex = message.mes.lastIndexOf(settings.thoughts_placeholder.end);

            if (lastThoughtEndIndex !== -1) {
                const indexToInsert = lastThoughtEndIndex + settings.thoughts_placeholder.end.length;
                message.mes = message.mes.substring(0, indexToInsert) + '\n' + this.#replaceThoughtsPlaceholder(event.thought) + message.mes.substring(indexToInsert);
            } else {
                console.debug('[Stepped Thinking] Unable to locate the end of the previous thought, inserting a new thought at the end of the message');
                message.mes += '\n' + this.#replaceThoughtsPlaceholder(event.thought);
            }
        }

        updateMessageBlock(event.thoughtsMessageId, message);

        await context.saveChat();

        if (settings.is_thoughts_spoiler_open) {
            scrollChatToBottom();
        }
    }

    /**
     * @return {Promise<void>}
     */
    async prepareGenerationPrompt() {
        // The prompt is automatically prepared based on the chat history in this strategy
    }

    /**
     * @param {OnSaveThoughtsEvent} event
     * @return {Promise<void>}
     */
    async saveCharacterThoughts(event) {
        // Thoughts are saved immediately after creating in this strategy
    }

    /**
     * @param {OnRenderThoughtsEvent} event
     * @return {Promise<void>}
     */
    async renderCharacterThoughts(event) {
        // Thoughts render automatically in this strategy
    }

    /**
     * @return {void}
     */
    makeIntermediateThoughtsOrphans() {
        // Cleaning the intermediate state is unnecessary in this strategy
    }

    /**
     * @return {void}
     */
    removeOrphanThoughts() {
        // No need to remove orphans in this strategy as they are not created
    }

    /**
     * @param {v1CharData} character
     * @param {string} text
     * @return {Promise<number>}
     */
    async #sendCharacterThoughts(character, text) {
        const context = getContext();

        let mesText;

        mesText = text.trim();

        const bias = extractMessageBias(mesText);
        const isSystem = bias && !removeMacros(mesText).length;
        const isAuthorSystem = settings.is_thoughts_as_system;

        const message = {
            name: isAuthorSystem ? context.substituteParams(settings.system_character_name_template) : character.name,
            is_user: false,
            is_system: isSystem,
            is_thoughts: true,
            thoughts_for: character.name,
            send_date: getMessageTimeStamp(),
            mes: context.substituteParams(mesText),
            extra: {
                type: isAuthorSystem ? 'narrator' : undefined,
                bias: bias.trim().length ? bias : null,
                gen_id: Date.now(),
                isSmallSys: false,
                api: 'script',
                model: 'stepped thinking',
            },
            owner_extension: extensionName,
        };

        message.swipe_id = 0;
        message.swipes = [message.mes];
        message.swipes_info = [{
            send_date: message.send_date, gen_started: null, gen_finished: null, extra: {
                bias: message.extra.bias,
                gen_id: message.extra.gen_id,
                isSmallSys: false,
                api: 'script',
                model: 'stepped thinking',
            },
        }];

        if (context.groupId || isAuthorSystem) {
            message.original_avatar = character.avatar;
            message.force_avatar = context.getThumbnailUrl('avatar', character.avatar);
        }

        context.chat.push(message);

        const position = context.chat.length - 1;

        await eventSource.emit(event_types.MESSAGE_RECEIVED, (position));
        addOneMessage(message);
        await eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, (position));
        await saveChatConditional();

        return position;
    }

    /**
     * @param {string} substitution
     * @return {string}
     */
    #replaceThoughtsPlaceholder(substitution) {
        const thoughtsPlaceholder = settings.thoughts_placeholder.start
            + settings.thoughts_placeholder.content
            + settings.thoughts_placeholder.end;
        return thoughtsPlaceholder.replace('{{thoughts}}', substitution);
    }
}

/**
 * @typedef {object} Thought
 * @property {number} id
 * @property {string} thought
 * @property {ThinkingPrompt} thinkingPrompt
 */

/**
 * @typedef {object} ThoughtsGeneration
 * @property {string} title
 * @property {boolean} is_hidden
 * @property {array<Thought>} thoughts
 */
/**
 * @implements {ThoughtsStrategy}
 */
class EmbeddedThoughtsStrategy {
    LAST_THOUGHT_ID = LAST_THOUGHT_ID;
    EXTENSION_PROMPT_PREFIX = 'STEPTHINK_THOUGHT_';

    /**
     * @var {EmbeddedThoughtsStrategy}
     */
    static #instance;

    /**
     * @var {EmbeddedThoughtsUI}
     */
    #ui;

    static getInstance() {
        if (!EmbeddedThoughtsStrategy.#instance) {
            EmbeddedThoughtsStrategy.#instance = new EmbeddedThoughtsStrategy(
                EmbeddedThoughtsUI.getInstance(),
            );
        }

        return EmbeddedThoughtsStrategy.#instance;
    }

    constructor(ui) {
        this.#ui = ui;
    }

    /**
     * @param {string} thoughtsId
     * @param {number} id
     * @return {function(): void}
     */
    static onEditThought(thoughtsId, id) {
        return function () {
            const context = getContext();
            const chatMessage = context.chat.find(message => message.thoughts_id === thoughtsId);
            const valueToEdit = chatMessage.character_thoughts.thoughts.find(thought => thought.id === id).thought;

            const thoughtsBlock = document.querySelector(`.thoughts[thoughts_id="${thoughtsId}"]`);
            const thoughtBlock = thoughtsBlock.querySelector(`.generated_thought[generated_thought_id="${id}"]`);

            const buttonsContainer = thoughtsBlock.querySelector(`.thought_control_buttons[generated_thought_id="${id}"]`);
            for (const button of buttonsContainer.children) {
                button.style.display = 'none';
            }

            const cancelButton = document.createElement('div');
            cancelButton.classList.add('menu_button', 'fa-solid', 'fa-xmark', 'interactable', 'thought_edit_cancel_button');

            const doneButton = document.createElement('div');
            doneButton.classList.add('menu_button', 'fa-solid', 'fa-check', 'interactable', 'thought_edit_done_button');

            buttonsContainer.append(doneButton, cancelButton);

            const textArea = document.createElement('textarea');
            textArea.value = valueToEdit;

            thoughtBlock.innerHTML = '';
            thoughtBlock.append(textArea);
        }
    }

    /**
     * @param {OnSendThoughtsTemplateEvent} event
     * @return {Promise<void>}
     */
    async sendCharacterTemplateMessage(event) {
        const context = getContext();
        const thoughtsMetadataId = this.LAST_THOUGHT_ID;

        /** @type {ThoughtsGeneration} */
        context.chatMetadata.thought_generation = {
            title: context.substituteParams(settings.thoughts_block_title),
            is_hidden: false,
            thoughts: [],
        };

        this.#ui.purgeUnboundThoughts();
        this.#ui.insertThoughtsTemplateBlock(
            context.chat.length - 1,
            thoughtsMetadataId,
            context.chatMetadata.thought_generation.title,
        );

        event.thoughtsMetadataId = thoughtsMetadataId;

        scrollChatToBottom();
    }

    /**
     * @param {OnPutThoughtsEvent} event
     * @return {Promise<void>}
     */
    async putCharacterThoughts(event) {
        const context = getContext();
        const thoughtGeneration = context.chatMetadata.thought_generation;

        const newThought = {
            id: thoughtGeneration.thoughts.length,
            thought: event.thought,
            thinkingPrompt: event.thinkingPrompt,
        };
        thoughtGeneration.thoughts.push(newThought);

        this.#ui.addThoughtToBlock(event.thoughtsMetadataId, newThought);

        scrollChatToBottom();
    }

    /**
     * @param {OnSaveThoughtsEvent} event
     * @return {Promise<void>}
     */
    async saveCharacterThoughts(event) {
        const context = getContext();
        const generatedThoughts = context.chatMetadata.thought_generation;
        if (!generatedThoughts) {
            return;
        }

        const message = context.chat[event.messageId];

        message.thoughts_id = uuidv4();
        message.character_thoughts = generatedThoughts;
        this.#ui.bindThoughtsBlock(event.messageId, message.thoughts_id, event.thoughtsMetadataId);

        context.chatMetadata.thought_generation = null;

        await saveChatConditional();
    }

    /**
     * @return {Promise<void>}
     */
    async prepareGenerationPrompt() {
        const context = getContext();
        this.#purgeInjectedThoughts();

        const lastMessageId = context.chat.length - 1;
        for (let i = lastMessageId; i >= 0; i--) {
            const message = context.chat[i];
            if (message.character_thoughts && !message.character_thoughts.is_hidden) {
                this.#injectThoughts(message.character_thoughts, message.thoughts_id, lastMessageId - i + 1);
            }
        }

        if (context.chatMetadata.thought_generation) {
            this.#injectThoughts(context.chatMetadata.thought_generation, this.LAST_THOUGHT_ID, 0);
        }
    }

    /**
     * @return {void}
     */
    makeIntermediateThoughtsOrphans() {
        const context = getContext();

        context.chatMetadata.thought_generation = null;
        this.#ui.unbindOrphanThoughtsBlock(this.LAST_THOUGHT_ID);
    }


    /**
     * @return {void}
     */
    removeOrphanThoughts() {
        this.#ui.purgeUnboundThoughts();
    }

    /**
     * @param {OnRenderThoughtsEvent} event
     * @return {Promise<void>}
     */
    async renderCharacterThoughts(event) {
        if (!event.isInitialCall) {
            this.#ui.removeUnboundThoughtBlocks();
        }

        this.#ui.renderThoughtBlocks();

        if (event.isInitialCall) {
            scrollChatToBottom();
        }
    }

    /**
     * @return {Promise<void>}
     */
    async hideThoughts() {
        const context = getContext();

        const currentCharacter = context.characters[context.characterId];
        const characterSettings = getCurrentCharacterSettings();

        const isMindReaderCharacter = Boolean(characterSettings && characterSettings.is_mind_reader);
        const isGeneratingForCurrentCharacter = (message) => context.chatMetadata.thought_generation && message.name === currentCharacter.name;

        const lastMessageIndex = context.chat.length - 1;
        for (let i = lastMessageIndex, revealedThoughtsCount = []; i >= 0 && (lastMessageIndex - i < settings.max_hiding_thoughts_lookup); i--) {
            const message = context.chat[i];

            revealedThoughtsCount[message.name] ??= isGeneratingForCurrentCharacter(message) ? 1 : 0;
            revealedThoughtsCount[message.name] += this.#revealThought(
                context.chat[i],
                revealedThoughtsCount[message.name],
                currentCharacter.name,
                isMindReaderCharacter,
            );
        }
    }

    /**
     * @param {ThoughtsGeneration} generatedThoughts
     * @param {string} thoughtsId
     * @param {number} depth
     * @return {void}
     */
    #injectThoughts(generatedThoughts, thoughtsId, depth) {
        const template = new EmbeddedThoughtsPromptTemplate(generatedThoughts);

        setExtensionPrompt(
            `${this.EXTENSION_PROMPT_PREFIX}_${thoughtsId}`,
            template.render(),
            extension_prompt_types.IN_CHAT,
            depth,
            true,
            settings.sending_thoughts_role,
        );
    }

    /**
     * @return {void}
     */
    #purgeInjectedThoughts() {
        for (const key of Object.keys(extension_prompts)) {
            if (key.startsWith(this.EXTENSION_PROMPT_PREFIX)) {
                delete extension_prompts[key];
            }
        }
    }

    /**
     * @param {object} message
     * @param {number} revealedCharThoughtsCount
     * @param {string} currentCharacterName
     * @param {boolean} isMindReaderCharacter
     * @return {number}
     */
    #revealThought(message, revealedCharThoughtsCount, currentCharacterName, isMindReaderCharacter) {
        const characterThoughts = message.character_thoughts;
        if (!characterThoughts) {
            return 0;
        }

        const previousHidingState = characterThoughts.is_hidden;
        characterThoughts.is_hidden =
            message.is_system
            || revealedCharThoughtsCount >= settings.max_thoughts_in_prompt
            || (!isMindReaderCharacter && currentCharacterName !== message.name);

        if (previousHidingState !== characterThoughts.is_hidden) {
            this.#ui.findThoughtAndRenderHidingState(message.thoughts_id, characterThoughts.is_hidden);
        }

        return characterThoughts.is_hidden ? 0 : 1;
    }
}

class EmbeddedThoughtsPromptTemplate {
    /**
     * @var {ThoughtsGeneration}
     */
    #generatedThoughts;

    constructor(generatedThoughts) {
        this.#generatedThoughts = generatedThoughts;
    }

    /**
     * @return {string}
     */
    render() {
        const prefix = this.#renderPrefix();
        const thoughts = this.#renderThoughts();

        return settings.general_injection_template
            .replaceAll('{{prefix}}', prefix)
            .replaceAll('{{thoughts}}', thoughts)
            ;
    }

    /**
     * @return {string}
     */
    #renderThoughts() {
        const thoughtsLastIndex = this.#generatedThoughts.thoughts.length - 1;

        return this.#generatedThoughts.thoughts.reduce(
            (result, currentThought, index) => result
                + settings.thought_injection_template
                    .replaceAll('{{thought}}', currentThought.thought)
                    .replaceAll('{{prompt_name}}', currentThought.thinkingPrompt.name)
                    .replaceAll('{{prompt_name.toLowerCase()}}', currentThought.thinkingPrompt.name.toLowerCase())
                + (index !== thoughtsLastIndex ? settings.thought_injection_separator : '')
            ,
            '');

    }

    /**
     * @return {string}
     */
    #renderPrefix() {
        const context = getContext();

        let mode = settings.thoughts_prefix_injection_mode;
        if (mode === thoughtPrefixInjectionModes.FROM_INSTRUCT) {
            mode = this.#importPrefixModeFromInstruct();
        }

        if (context.groupId) {
            if (mode !== thoughtPrefixInjectionModes.NEVER) {
                return settings.thoughts_injection_prefix;
            }

            return '';
        }

        if (mode === thoughtPrefixInjectionModes.ALWAYS) {
            return settings.thoughts_injection_prefix;
        }

        return '';
    }

    /**
     * @return {string}
     */
    #importPrefixModeFromInstruct() {
        if (power_user.instruct.enabled) {
            if (power_user.instruct.names_behavior === names_behavior_types.NONE) {
                return thoughtPrefixInjectionModes.NEVER;
            }

            if (settings.sending_thoughts_role === extension_prompt_roles.SYSTEM) {
                return thoughtPrefixInjectionModes.ALWAYS;
            }

            return thoughtPrefixInjectionModes.NEVER;
        }

        return thoughtPrefixInjectionModes.ALWAYS;
    }
}

class EmbeddedThoughtsUI {
    /**
     * @var {EmbeddedThoughtsUI}
     */
    static #instance;

    static getInstance() {
        if (!EmbeddedThoughtsUI.#instance) {
            EmbeddedThoughtsUI.#instance = new EmbeddedThoughtsUI();
        }

        return EmbeddedThoughtsUI.#instance;
    }

    /**
     * @param {number} previousMessageId
     * @param {string} thoughtsId
     * @param {string} title
     * @return {void}
     */
    insertThoughtsTemplateBlock(previousMessageId, thoughtsId, title) {
        const lastMessage = document.querySelector(`#chat .mes[mesid="${previousMessageId}"]`);
        const thoughtsTemplate = this.#createThoughtsBlock(thoughtsId, title);

        lastMessage.classList.remove('last_mes');
        lastMessage.after(thoughtsTemplate);
    }

    /**
     * @param {string} thoughtsId
     * @param {Thought} thought
     * @return {void}
     */
    addThoughtToBlock(thoughtsId, thought) {
        const thoughtsTemplate = this.#findThoughtsBlock(thoughtsId);
        this.#insertThoughtIntoBlockContent(thoughtsTemplate, thoughtsId, thought);
    }

    /**
     * @param {int} messageToBindId
     * @param {string} thoughtsId
     * @param {?string} previousThoughtsId
     */
    bindThoughtsBlock(messageToBindId, thoughtsId, previousThoughtsId = null) {
        const thoughtsBlock = this.#findThoughtsBlock(previousThoughtsId ?? thoughtsId);
        this.#updateThoughtBlockId(thoughtsBlock, thoughtsId);

        const messageBlock = document.querySelector(`#chat .mes[mesid="${messageToBindId}"]`);
        this.#attachMessageToThoughts(messageBlock, thoughtsId);
    }

    /**
     * @param {string} id
     * @param {boolean} isHidden
     * @return {void}
     */
    findThoughtAndRenderHidingState(id, isHidden) {
        const thoughtsBlock = this.#findThoughtsBlock(id);
        if (thoughtsBlock) {
            this.#renderHidingState(thoughtsBlock, isHidden);
        }
    }

    /**
     * @return {void}
     */
    removeUnboundThoughtBlocks() {
        $('#chat .thoughts').each((_, thoughtsBlock) => {
            const thoughtsId = thoughtsBlock.getAttribute('thoughts_id');
            const boundMessageBlock = document.querySelector(`#chat .mes[thoughts_id="${thoughtsId}"]`);
            if (!boundMessageBlock) {
                thoughtsBlock.remove();
            }
        });
    }

    /**
     * @return {void}
     */
    renderThoughtBlocks() {
        const context = getContext();

        $('#chat .mes').each((_, messageBlock) => {
            if (messageBlock.getAttribute('thoughts_rendered') === 'true') {
                this.#reattachDetachedThoughtBlocks(messageBlock);
                return;
            }

            const messageId = messageBlock.getAttribute('mesid');
            const message = context.chat[messageId];
            /** @var {ThoughtsGeneration} message.character_thoughts */
            if (!message.character_thoughts) {
                messageBlock.setAttribute('thoughts_rendered', 'true');
                return;
            }

            const thoughtsBlock = this.#createThoughtsBlock(
                message.thoughts_id,
                message.character_thoughts.title,
            );
            this.#renderHidingState(thoughtsBlock, message.character_thoughts.is_hidden);
            for (const thought of message.character_thoughts.thoughts) {
                this.#insertThoughtIntoBlockContent(thoughtsBlock, message.thoughts_id, thought);
            }

            messageBlock.before(thoughtsBlock);
            this.#attachMessageToThoughts(messageBlock, message.thoughts_id);
        });
    }

    /**
     * @param {string} id
     * @return {void}
     */
    unbindOrphanThoughtsBlock(id) {
        const lastThoughtsBlock = this.#findThoughtsBlock(id);
        if (!lastThoughtsBlock) {
            return;
        }

        const siblingElement = this.#findClosestSibling(lastThoughtsBlock, 'mes', 'down');
        if (siblingElement
            && siblingElement.classList.contains('mes')
            && siblingElement.getAttribute('thoughts_rendered') !== 'true') {
            return;
        }

        lastThoughtsBlock.classList.add('unbound_thoughts');
    }

    /**
     * @return {void}
     */
    purgeUnboundThoughts() {
        document.querySelector('.unbound_thoughts')?.remove();
    }

    /**
     * This is a crutch required to fix detached thought blocks problem after clicking the "Show more messages" button
     *
     * @param {HTMLDivElement} messageBlock
     * @return {void}
     */
    #reattachDetachedThoughtBlocks(messageBlock) {
        const messageThoughtsId = messageBlock.getAttribute('thoughts_id');
        if (!messageThoughtsId) {
            return;
        }

        const boundThoughtsBlock = this.#findThoughtsBlock(messageThoughtsId);
        messageBlock.before(boundThoughtsBlock);
    }

    /**
     * @param {string} id
     * @param {?string} title
     * @return {HTMLDivElement}
     */
    #createThoughtsBlock(id, title = null) {
        const thoughtsBlock = document.createElement('div');
        this.#updateThoughtBlockId(thoughtsBlock, id);
        thoughtsBlock.classList.add('thoughts');

        const detailsBlock = document.createElement('details');
        if (settings.is_thoughts_spoiler_open) {
            detailsBlock.open = settings.is_thoughts_spoiler_open;
        }
        detailsBlock.classList.add('thought_details');

        const summaryBlock = this.#createThoughtsSummaryBlock(title);

        detailsBlock.append(summaryBlock);
        thoughtsBlock.append(detailsBlock);

        return thoughtsBlock;
    }

    /**
     * @param {string} title
     * @return {HTMLElement}
     */
    #createThoughtsSummaryBlock(title) {
        const summaryBlock = document.createElement('summary');
        summaryBlock.classList.add('thought_summary');

        const summaryContainer = document.createElement('div');
        summaryContainer.classList.add('thought_summary_container');

        const summaryTitle = document.createElement('div');
        summaryTitle.classList.add('flex1');
        if (title !== null) {
            summaryTitle.innerHTML = `<b>${title}</b>&nbsp;`;
        }
        summaryTitle.innerHTML += '<i class="mes_ghost fa-solid fa-ghost" title="These thoughts won\'t be included in the prompt" style="display: none"></i>';

        const summaryButtonContainer = document.createElement('div');
        summaryButtonContainer.classList.add('thought_control_buttons');

        const deleteButton = document.createElement('div');
        deleteButton.classList.add('mes_button', 'fa-solid', 'fa-trash-can', 'interactable');

        const regenerateButton = document.createElement('div');
        regenerateButton.classList.add('mes_button', 'fa-solid', 'fa-rotate', 'interactable');

        summaryButtonContainer.append(deleteButton, regenerateButton);
        summaryContainer.append(summaryTitle, summaryButtonContainer);
        summaryBlock.append(summaryContainer);

        return summaryBlock;
    }

    /**
     * @param {HTMLDivElement} thoughtsBlock
     * @param {string} thoughtsId
     * @param {Thought} thought
     * @return {void}
     */
    #insertThoughtIntoBlockContent(thoughtsBlock, thoughtsId, thought) {
        const context = getContext();
        const detailsBlock = thoughtsBlock.querySelector('.thought_details');

        const thoughtContainer = document.createElement('div');
        const thoughtNameContainer = this.#createThoughtsNameBlock(thoughtsId, thought);

        const thoughtBlock = document.createElement('div');
        thoughtBlock.setAttribute('id', `generated_thought--${thought.id}`);
        thoughtBlock.setAttribute('generated_thought_id', String(thought.id));
        thoughtBlock.classList.add('mes_text', 'generated_thought');

        thoughtBlock.innerHTML = context.messageFormatting(thought.thought, '', false, false, -1);

        thoughtContainer.append(thoughtNameContainer, thoughtBlock);

        detailsBlock.append(thoughtContainer);
    }

    /**
     * @param {string} thoughtsId
     * @param {Thought} thought
     * @return {HTMLDivElement}
     */
    #createThoughtsNameBlock(thoughtsId, thought) {
        const thoughtNameContainer = document.createElement('div');
        thoughtNameContainer.classList.add('generated_thought_name', 'flex-container', 'justifySpaceBetween', 'flexFlowRow');

        const thoughtName = document.createElement('div');
        thoughtName.innerHTML = thought.thinkingPrompt.name;

        const thoughtNameButtonsContainer = document.createElement('div');
        thoughtNameButtonsContainer.classList.add('thought_control_buttons');
        thoughtNameButtonsContainer.setAttribute('generated_thought_id', String(thought.id));

        const editButton = document.createElement('div');
        editButton.classList.add('mes_button', 'fa-solid', 'fa-pencil', 'interactable');
        editButton.addEventListener('click', EmbeddedThoughtsStrategy.onEditThought(thoughtsId, thought.id));

        const regenerateButton = document.createElement('div');
        regenerateButton.classList.add('mes_button', 'fa-solid', 'fa-rotate', 'interactable');

        thoughtNameButtonsContainer.append(editButton, regenerateButton);
        thoughtNameContainer.append(thoughtName, thoughtNameButtonsContainer);

        return thoughtNameContainer;
    }

    /**
     * @param {HTMLDivElement} thoughtsBlock
     * @param {string} id
     * @return {void}
     */
    #updateThoughtBlockId(thoughtsBlock, id) {
        thoughtsBlock.setAttribute('id', `thoughts_mes--${id}`);
        thoughtsBlock.setAttribute('thoughts_id', id);
    }

    /**
     * @param {string} id
     * @return {HTMLDivElement}
     */
    #findThoughtsBlock(id) {
        return document.getElementById(`thoughts_mes--${id}`);
    }

    /**
     * @param {HTMLDivElement} messageBlock
     * @param {string} thoughtsId
     * @return {void}
     */
    #attachMessageToThoughts(messageBlock, thoughtsId) {
        messageBlock.setAttribute('thoughts_rendered', 'true');
        messageBlock.setAttribute('thoughts_id', thoughtsId);
    }

    #renderHidingState(thoughtsBlock, isHidden) {
        const ghostIcon = thoughtsBlock.querySelector('.thought_summary .mes_ghost');

        if (isHidden) {
            ghostIcon.style.display = '';
        } else {
            ghostIcon.style.display = 'none';
        }
    }

    /**
     * @param {HTMLDivElement} startElement
     * @param {string} targetClass
     * @param {string} direction
     * @return {HTMLDivElement|null}
     */
    #findClosestSibling(startElement, targetClass, direction) {
        const findSibling = (element, getNextSibling) => {
            let sibling = getNextSibling(element);
            while (sibling) {
                if (sibling.classList.contains(targetClass)) {
                    return sibling;
                }
                sibling = getNextSibling(sibling);
            }

            return null;
        };

        if (direction === 'up') {
            return findSibling(startElement, element => element.previousElementSibling);
        }

        return findSibling(startElement, element => element.nextElementSibling);
    }
}
