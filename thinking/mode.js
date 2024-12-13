import {
    addOneMessage,
    event_types,
    eventSource,
    extension_prompt_roles,
    extension_prompt_types,
    extension_prompts,
    extractMessageBias,
    reloadCurrentChat,
    removeMacros,
    saveChatDebounced,
    scrollChatToBottom,
    setExtensionPrompt,
    updateMessageBlock,
} from '../../../../../script.js';
import { getCharacterSettings, hideThoughts, runRefreshGeneratedThoughts } from './engine.js';
import { getContext } from '../../../../extensions.js';
import { settings, thoughtPrefixInjectionModes } from '../settings/settings.js';
import { hideChatMessageRange } from '../../../../chats.js';
import { getMessageTimeStamp } from '../../../../RossAscends-mods.js';
import { extensionName } from '../index.js';
import { uuidv4 } from '../../../../utils.js';
import { power_user } from '../../../../power-user.js';
import { names_behavior_types } from '../../../../instruct-mode.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../popup.js';
import { oai_settings } from '../../../../openai.js';
import { adjustPromptForCharacter } from './prompt_adjustment.js';

/**
 * @typedef {object} ThoughtsGenerationPlan
 * @property {function(number?): Promise<void>} hideThoughts
 * @property {function(string): Promise<void>} prepareGenerationPrompt
 * @property {function(string, ThinkingPrompt): Promise<void>} putCharacterThoughts
 * @property {function(): Promise<void>} saveCharacterThoughts
 * @property {function(): void} orphanIntermediateUnboundThoughts
 * @property {function(): ThinkingPrompt[]} getThinkingPrompts
 * @property {function(): number} getCharacterId
 */
/**
 * @typedef {object} ThoughtsMode
 * @property {function(ThoughtsTemplatePosition, ThinkingPrompt[], number): ThoughtsGenerationPlan} createNewThoughtsGenerationPlan
 * @property {function(ThoughtPosition): ThoughtsGenerationPlan} createRefreshThoughtsGenerationPlan
 * @property {function(): ThoughtsGenerationPlan} createDefaultGenerationPlan
 * @property {function(): Promise<ThoughtsTemplatePosition>} sendCharacterTemplateMessage
 * @property {function(): void} renderInitialCharacterThoughts
 * @property {function(): void} renderCharacterThoughts
 * @property {function(): void} removeOrphanThoughts
 * @property {function(string): Promise<void>} deleteThoughts
 * @property {function(string): Promise<number>} deleteHiddenThoughts
 * @property {function(): boolean} isEmbeddedInMessages
 */
/**
 * @typedef {object} ThoughtsModeDeclaration
 * @property {string} name
 * @property {string} title
 * @property {ThoughtsMode} mode
 */

/**
 * @typedef {object} Thought
 * @property {number} id
 * @property {string} thought
 * @property {ThinkingPrompt} thinkingPrompt
 */
/**
 * @typedef {object} ThoughtsGeneration
 * @property {string} thoughts_id
 * @property {string} title
 * @property {boolean} is_hidden
 * @property {array<Thought>} thoughts
 */

/**
 * @typedef {object} ThoughtsEditingStorage
 * @property {function(ThoughtsEditing): void} setCurrentEditing
 * @property {function(): ThoughtsEditing} getCurrentEditing
 * @property {function(): void} resetCurrentEditing
 */

/**
 * @typedef {object} ThoughtsGenerationStorage
 */

/**
 * @var {ThoughtsModeDeclaration[]}
 */
let modeDeclarations = [];

/**
 * @return {void}
 */
export function loadDefaultModeDeclarations() {
    registerMode('separated', '[Deprecated] Separated', SeparatedThoughtsMode.getInstance());
    registerMode('embedded', '[New!] Embedded', EmbeddedThoughtsMode.getInstance());
}

/**
 * @return {Generator<{name: string, title: string}>}
 */
export function* modesIterator() {
    for (const declaration of modeDeclarations) {
        yield { name: declaration.name, title: declaration.title };
    }
}

/**
 * @param {string} name
 * @param {string} title
 * @param {ThoughtsMode} mode
 * @return {void}
 */
export function registerMode(name, title, mode) {
    modeDeclarations.push({
        name: name,
        title: title,
        mode: mode,
    });
}

/**
 * @param {string} name
 * @return {ThoughtsMode}
 */
export function findMode(name) {
    const declaration = modeDeclarations.find(declaration => declaration.name === name);
    if (!declaration) {
        throw new Error(`[Stepped Thinking] Unable to find mode {$name}. Register it first with the registerMode function.`);
    }

    return declaration.mode;
}

/**
 * @return {void}
 */
export function registerThinkingModeListeners() {
    eventSource.on(event_types.GENERATION_STARTED, async () => {
        const storage = ThoughtsEditingStaticStorage.getInstance();
        const currentEditing = storage.getCurrentEditing();

        if (currentEditing) {
            await currentEditing.applyEdits();
            storage.resetCurrentEditing();
        }
    });
}

export class ThoughtPosition {
    /**
     * @var {string|number}
     */
    #thoughtsId;
    /**
     * @var {number}
     */
    #thoughtItemId;

    constructor(thoughtsId, thoughtItemId) {
        this.#thoughtsId = thoughtsId;
        this.#thoughtItemId = thoughtItemId;
    }

    get thoughtsId() {
        return this.#thoughtsId;
    }

    get thoughtItemId() {
        return this.#thoughtItemId;
    }
}

export class ThoughtsTemplatePosition {
    /**
     * @var {number}
     */
    #messageId;
    /**
     * @var {?string}
     */
    #thoughtsId;
    /**
     * @var {?string}
     */
    #title;

    constructor(messageId, thoughtsId = null, title = null) {
        this.#messageId = messageId;
        this.#thoughtsId = thoughtsId;
        this.#title = title;
    }

    get messageId() {
        return this.#messageId;
    }

    get thoughtsId() {
        return this.#thoughtsId;
    }

    get title() {
        return this.#title;
    }
}

export class ThoughtsEditing {
    /**
     * @var {ThoughtsEditingStorage}
     */
    _storage;

    constructor(storage) {
        this._storage = storage;
    }

    /**
     * @return {function(): Promise<void>}
     */
    onStartEditing() {
        return async () => {
            const currentEditing = this._storage.getCurrentEditing();

            if (currentEditing) {
                await currentEditing.applyEdits();
            }
            this._storage.setCurrentEditing(this);

            this.startEditing();
        };
    }

    /**
     * @return {function(): Promise<void>}
     */
    onApplyEdits() {
        return async () => {
            await this._storage.getCurrentEditing().applyEdits();
            this._storage.resetCurrentEditing();
        };
    }

    /**
     * @return {function(): void}
     */
    onCancelEdits() {
        return () => {
            this._storage.getCurrentEditing().cancelEdits();
            this._storage.resetCurrentEditing();
        };
    }

    /**
     * @return {void}
     */
    startEditing() {
        // Need to be implemented in a child
    }

    /**
     * @return {Promise<void>}
     */
    async applyEdits() {
        // Need to be implemented in a child
    }

    /**
     * @return {void}
     */
    cancelEdits() {
        // Need to be implemented in a child
    }
}

/**
 * @implements {ThoughtsEditingStorage}
 */
export class ThoughtsEditingStaticStorage {
    /**
     * @var {ThoughtsEditingStaticStorage}
     */
    static #instance;
    /**
     * @var {ThoughtsEditing}
     */
    static #currentEditing;

    static getInstance() {
        if (!ThoughtsEditingStaticStorage.#instance) {
            ThoughtsEditingStaticStorage.#instance = new ThoughtsEditingStaticStorage();
        }

        return ThoughtsEditingStaticStorage.#instance;
    }

    /**
     * @param {ThoughtsEditing} editing
     * @return {void}
     */
    setCurrentEditing(editing) {
        ThoughtsEditingStaticStorage.#currentEditing = editing;
    }

    /**
     * @return {ThoughtsEditing}
     */
    getCurrentEditing() {
        return ThoughtsEditingStaticStorage.#currentEditing;
    }

    /**
     * @return {void}
     */
    resetCurrentEditing() {
        ThoughtsEditingStaticStorage.#currentEditing = null;
    }
}

export class ThoughtsGenerationMetadataStorage {
    /**
     * @var {ThoughtsGenerationMetadataStorage}
     */
    static #instance;

    static getInstance() {
        if (!ThoughtsGenerationMetadataStorage.#instance) {
            ThoughtsGenerationMetadataStorage.#instance = new ThoughtsGenerationMetadataStorage();
        }

        return ThoughtsGenerationMetadataStorage.#instance;
    }

    /**
     * @param {number} messageId
     * @param {ThoughtsGeneration} thoughtsGeneration
     * @return {ThoughtsGenerationMetadataStorage}
     */
    static getInstanceWithGeneration(messageId, thoughtsGeneration) {
        const context = getContext();

        context.chatMetadata.thought_generation = thoughtsGeneration;
        context.chatMetadata.thought_target_message_id = messageId;

        return ThoughtsGenerationMetadataStorage.getInstance();
    }

    /**
     * @param {ThoughtsTemplatePosition} templatePosition
     * @return {ThoughtsGenerationMetadataStorage}
     */
    static getInstanceForTemplate(templatePosition) {
        const context = getContext();

        context.chatMetadata.thought_generation = {
            thoughts_id: templatePosition.thoughtsId,
            title: templatePosition.title,
            is_hidden: false,
            thoughts: [],
        };
        context.chatMetadata.thought_target_message_id = templatePosition.messageId;

        return ThoughtsGenerationMetadataStorage.getInstance();
    }

    /**
     * @return {ThoughtsGeneration}
     */
    getThoughtsGeneration() {
        const context = getContext();
        return context.chatMetadata.thought_generation;
    }

    /**
     * @param {Thought} thought
     * @return {void}
     */
    addThoughtToGeneration(thought) {
        const context = getContext();
        const thoughtGeneration = context.chatMetadata.thought_generation;

        if (!thoughtGeneration) {
            throw new Error('[Stepped Thinking] Cannot add thought to an empty generation');
        }

        const storedThoughtId = thoughtGeneration.thoughts.findIndex(storedThought => storedThought.id === thought.id);
        if (storedThoughtId !== -1) {
            thoughtGeneration.thoughts[storedThoughtId] = thought;
            return;
        }

        thoughtGeneration.thoughts.push(thought);
    }

    /**
     * @return {boolean}
     */
    isEmptyThoughts() {
        const context = getContext();
        if (!context.chatMetadata.thought_generation) {
            return true;
        }

        return context.chatMetadata.thought_generation.thoughts.length === 0;
    }

    /**
     * @return {boolean}
     */
    isEmpty() {
        return this.isEmptyThoughts() || this.getTargetMessageId() === null;
    }

    /**
     * @return {number}
     */
    getTargetMessageId() {
        const context = getContext();
        return context.chatMetadata.thought_target_message_id;
    }

    /**
     * @return {void}
     */
    reset() {
        const context = getContext();
        context.chatMetadata.thought_generation = null;
        context.chatMetadata.thought_target_message_id = null;
    }
}

// separated

/**
 * @implements {ThoughtsMode}
 */
export class SeparatedThoughtsMode {
    /**
     * @var {SeparatedThoughtsMode}
     */
    static #instance;

    /**
     * @var {ThoughtsGenerationPlan}
     */
    #defaultPlan;

    static getInstance() {
        if (!SeparatedThoughtsMode.#instance) {
            SeparatedThoughtsMode.#instance = new SeparatedThoughtsMode();
        }

        return SeparatedThoughtsMode.#instance;
    }

    /**
     * @param {string} substitution
     * @return {string}
     */
    static replaceThoughtsPlaceholder(substitution) {
        const thoughtsPlaceholder = settings.thoughts_placeholder.start
            + settings.thoughts_placeholder.content
            + settings.thoughts_placeholder.end;
        return thoughtsPlaceholder.replace('{{thoughts}}', substitution);
    }

    /**
     * @param {ThoughtsTemplatePosition} templatePosition
     * @param {ThinkingPrompt[]} thinkingPrompts
     * @param {number} characterId
     * @return {ThoughtsGenerationPlan}
     */
    createNewThoughtsGenerationPlan(templatePosition, thinkingPrompts, characterId) {
        return new SeparatedThoughtsGenerationPlan(templatePosition, thinkingPrompts, characterId);
    }

    /**
     * @param {ThoughtPosition} thoughtPosition
     * @return {ThoughtsGenerationPlan}
     */
    createRefreshThoughtsGenerationPlan(thoughtPosition) {
        throw new Error('[Stepped Thinking] SeparatedThoughtsMode does not support refresh generation plans');
    }

    /**
     * @return {ThoughtsGenerationPlan}
     */
    createDefaultGenerationPlan() {
        if (!this.#defaultPlan) {
            this.#defaultPlan = new SeparatedThoughtsDefaultPlan();
        }

        return this.#defaultPlan;
    }

    /**
     * @return {Promise<ThoughtsTemplatePosition>}
     */
    async sendCharacterTemplateMessage() {
        const context = getContext();
        const openState = settings.is_thoughts_spoiler_open ? 'open' : '';

        const thoughtsMessage = settings.thoughts_message_template
            .replace('{{thoughts_spoiler_open_state}}', openState)
            .replace('{{thoughts_placeholder}}', SeparatedThoughtsMode.replaceThoughtsPlaceholder(settings.thoughts_placeholder.default_content));

        return new ThoughtsTemplatePosition(
            await this.#sendCharacterThoughts(context.characters[context.characterId], thoughtsMessage),
        );
    }

    /**
     * @return {void}
     */
    renderInitialCharacterThoughts() {
        // Thoughts render automatically in this mode
    }

    /**
     * @return {void}
     */
    renderCharacterThoughts() {
        // Thoughts render automatically in this mode
    }

    /**
     * @return {void}
     */
    removeOrphanThoughts() {
        // No need to remove orphans in this mode as they are not created
    }

    /**
     * @return {boolean}
     */
    isEmbeddedInMessages() {
        return false;
    }

    /**
     * @param {string} thoughtsId
     * @return {Promise<void>}
     */
    async deleteThoughts(thoughtsId) {
        // Since thoughts are regular messages in this mode, they are deleted by the built-in SillyTavern logic
    }

    /**
     * @param {?string} characterName
     * @return {Promise<number>}
     */
    async deleteHiddenThoughts(characterName = null) {
        const context = getContext();
        const messagesToDelete = [];

        context.chat.forEach(message => {
            if (message.is_thoughts
                && message.is_system
                && (!characterName || message.thoughts_for === characterName || message.name === characterName)
            ) {
                messagesToDelete.push(message);
            }
        });

        for (const message of messagesToDelete) {
            const index = context.chat.indexOf(message);
            if (index !== -1) {
                console.debug(`[Stepped Thinking] Deleting thoughts at #${index}`, message);
                context.chat.splice(index, 1);
            }
        }

        await context.saveChat();
        await reloadCurrentChat();

        return messagesToDelete.length;
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
            is_thoughts_empty: true,
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
        await context.saveChat();

        return position;
    }
}

/**
 * @implements {ThoughtsGenerationPlan}
 */
export class SeparatedThoughtsGenerationPlan {
    /**
     * @var {ThoughtsTemplatePosition}
     */
    _templatePosition;
    /**
     * @var {ThinkingPrompt[]}
     */
    _thinkingPrompts;
    /**
     * @var {number}
     */
    _characterId;

    constructor(templatePosition, thinkingPrompts, characterId) {
        this._templatePosition = templatePosition;
        this._thinkingPrompts = thinkingPrompts;
        this._characterId = characterId;
    }

    /**
     * @param {?number} characterId
     * @return {Promise<void>}
     */
    async hideThoughts(characterId = null) {
        const context = getContext();
        const maxThoughts = settings.max_thoughts_in_prompt;

        const currentCharacter = context.characters[Number.isInteger(characterId) ? characterId : this.getCharacterId()];
        if (!currentCharacter) {
            console.log('[Stepped Thinking] Unable to find a character for hiding thoughts');
            return;
        }

        const characterSettings = getCharacterSettings(characterId);

        const isMindReaderCharacter = Boolean(characterSettings && characterSettings.is_mind_reader);
        const hasAccessToThought = (chatThoughtName) => isMindReaderCharacter || chatThoughtName === currentCharacter.name;

        let promises = [];
        const lastMessageIndex = context.chat.length - 1;
        for (let i = lastMessageIndex, thoughtsCount = []; i >= 0 && (lastMessageIndex - i < settings.max_hiding_thoughts_lookup); i--) {
            if (Boolean(context.chat[i]?.is_thoughts) && !Boolean(context.chat[i]?.is_thoughts_empty)) {
                const chatThoughtName = context.chat[i].thoughts_for;
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
     * @param {string} generatedThought
     * @param {ThinkingPrompt} thinkingPrompt
     * @return {Promise<void>}
     */
    async putCharacterThoughts(generatedThought, thinkingPrompt) {
        const context = getContext();
        if (!context.chat[this._templatePosition.messageId]) {
            toastr.error('The message was not found at position ' + this._templatePosition.messageId + ', cannot insert thoughts. ' + 'Probably, the error was caused by unexpected changes in the chat.', 'Stepped Thinking', { timeOut: 10000 });
            return;
        }
        const message = context.chat[this._templatePosition.messageId];
        const defaultPlaceholder = SeparatedThoughtsMode.replaceThoughtsPlaceholder(settings.thoughts_placeholder.default_content);

        const isFirstThought = (message) => message.mes.search(defaultPlaceholder) !== -1;

        if (isFirstThought(message)) {
            message.mes = message.mes.replace(defaultPlaceholder, SeparatedThoughtsMode.replaceThoughtsPlaceholder(generatedThought));
        } else {
            const lastThoughtEndIndex = message.mes.lastIndexOf(settings.thoughts_placeholder.end);

            if (lastThoughtEndIndex !== -1) {
                const indexToInsert = lastThoughtEndIndex + settings.thoughts_placeholder.end.length;
                message.mes = message.mes.substring(0, indexToInsert) + '\n' + SeparatedThoughtsMode.replaceThoughtsPlaceholder(generatedThought) + message.mes.substring(indexToInsert);
            } else {
                console.debug('[Stepped Thinking] Unable to locate the end of the previous thought, inserting a new thought at the end of the message');
                message.mes += '\n' + SeparatedThoughtsMode.replaceThoughtsPlaceholder(generatedThought);
            }
        }

        updateMessageBlock(this._templatePosition.messageId, message);
        message.is_thoughts_empty = false;

        await context.saveChat();

        if (settings.is_thoughts_spoiler_open) {
            scrollChatToBottom();
        }
    }

    /**
     * @param {string} generationType
     * @return {Promise<void>}
     */
    async prepareGenerationPrompt(generationType) {
        // The prompt is automatically prepared based on the chat history in this mode
    }

    /**
     * @return {Promise<void>}
     */
    async saveCharacterThoughts() {
        // Thoughts are saved immediately after creating in this mode
    }

    /**
     * @return {void}
     */
    orphanIntermediateUnboundThoughts() {
        // Cleaning the intermediate state is unnecessary in this mode
    }

    /**
     * @return {ThinkingPrompt[]}
     */
    getThinkingPrompts() {
        return this._thinkingPrompts;
    }

    /**
     * @return {number}
     */
    getCharacterId() {
        return this._characterId;
    }
}

/**
 * @implements {ThoughtsGenerationPlan}
 */
export class SeparatedThoughtsDefaultPlan extends SeparatedThoughtsGenerationPlan {
    constructor() {
        super(new ThoughtsTemplatePosition(null), [], null);
    }

    /**
     * @param {string} generatedThought
     * @param {ThinkingPrompt} thinkingPrompt
     * @return {Promise<void>}
     */
    async putCharacterThoughts(generatedThought, thinkingPrompt) {
        console.warn('[Stepped Thinking] Cannot use SeparatedThoughtsDefaultPlan for thoughts generation');
    }

    /**
     * @return {number}
     */
    getCharacterId() {
        return parseInt(getContext().characterId);
    }
}

// embedded

/**
 * @implements {ThoughtsMode}
 */
export class EmbeddedThoughtsMode {
    /**
     * @var {EmbeddedThoughtsMode}
     */
    static #instance;
    /**
     * @var {EmbeddedThoughtsDefaultPlan}
     */
    #defaultPlan;
    /**
     * @var {EmbeddedThoughtsUI}
     */
    _ui;

    static getInstance() {
        if (!EmbeddedThoughtsMode.#instance) {
            EmbeddedThoughtsMode.#instance = new EmbeddedThoughtsMode(
                EmbeddedThoughtsUI.getInstance(),
            );
        }

        return EmbeddedThoughtsMode.#instance;
    }

    constructor(ui) {
        this._ui = ui;
    }

    /**
     * @param {ThoughtsTemplatePosition} templatePosition
     * @param {ThinkingPrompt[]} thinkingPrompts
     * @param {number} characterId
     * @return {ThoughtsGenerationPlan}
     */
    createNewThoughtsGenerationPlan(templatePosition, thinkingPrompts, characterId) {
        return EmbeddedThoughtsGenerationPlan.createForTemplate(templatePosition, thinkingPrompts, characterId);
    }

    /**
     * @param {ThoughtPosition} thoughtPosition
     * @return {ThoughtsGenerationPlan}
     */
    createRefreshThoughtsGenerationPlan(thoughtPosition) {
        return EmbeddedThoughtsRefreshPlan.createForPosition(thoughtPosition);
    }

    /**
     * @return {ThoughtsGenerationPlan}
     */
    createDefaultGenerationPlan() {
        if (!this.#defaultPlan) {
            this.#defaultPlan = new EmbeddedThoughtsDefaultPlan();
        }

        return this.#defaultPlan;
    }

    /**
     * @return {Promise<ThoughtsTemplatePosition>}
     */
    async sendCharacterTemplateMessage() {
        const context = getContext();

        const thoughtsId = uuidv4();
        const messageId = context.chat.length;
        const title = context.substituteParams(settings.thoughts_block_title);

        this.removeOrphanThoughts();
        this._ui.createThoughtsContainerTemplate(
            thoughtsId,
            context.substituteParams(settings.thoughts_block_title),
            this.deleteThoughts.bind(this)
        );

        scrollChatToBottom();

        return new ThoughtsTemplatePosition(messageId, thoughtsId, title);
    }

    /**
     * @return {void}
     */
    removeOrphanThoughts() {
        this._ui.purgeUnboundThoughts();
    }

    /**
     * @return {void}
     */
    renderInitialCharacterThoughts() {
        this._ui.renderThoughts(getContext().chat, this.deleteThoughts.bind(this));
        scrollChatToBottom();
    }

    /**
     * @return {void}
     */
    renderCharacterThoughts() {
        this._ui.removeUnboundThoughts();
        this._ui.renderThoughts(getContext().chat, this.deleteThoughts.bind(this));
    }

    /**
     * @param {string} thoughtsId
     * @return {Promise<void>}
     */
    async deleteThoughts(thoughtsId) {
        const context = getContext();
        const chatMessage = context.chat.find(message => message.character_thoughts?.thoughts_id === thoughtsId);
        if (!chatMessage) {
            return;
        }

        const confirmationResult = await callGenericPopup(
            'Are you sure you want to remove these thoughts?<br/>This action cannot be undone.',
            POPUP_TYPE.CONFIRM,
        );
        if (!confirmationResult) {
            return;
        }

        this.#deleteThoughtsFromMessage(chatMessage);
        saveChatDebounced();
    }

    /**
     * @return {boolean}
     */
    isEmbeddedInMessages() {
        return true;
    }

    /**
     * @param {?string} characterName
     * @return {Promise<number>}
     */
    async deleteHiddenThoughts(characterName = null) {
        const context = getContext();
        const messagesToDeleteThoughts = context.chat.filter(
            message =>
                message.character_thoughts?.is_hidden
                && (!characterName || message.name === characterName),
        );

        for (const chatMessage of messagesToDeleteThoughts) {
            this.#deleteThoughtsFromMessage(chatMessage);
        }

        saveChatDebounced();
        return messagesToDeleteThoughts.length;
    }

    /**
     * @param {object} chatMessage
     * @return {void}
     */
    #deleteThoughtsFromMessage(chatMessage) {
        this._ui.removeThoughtsContainer(chatMessage.character_thoughts.thoughts_id);
        delete chatMessage.character_thoughts;
    }
}

/**
 * @implements {ThoughtsGenerationPlan}
 */
export class EmbeddedThoughtsGenerationPlan {
    /**
     * @var {ThinkingPrompt[]}
     */
    _thinkingPrompts;
    /**
     * @var {number}
     */
    _characterId;
    /**
     * @var {EmbeddedThoughtsUI}
     */
    _ui;
    /**
     * @var {EmbeddedThoughtsPromptInjector}
     */
    _promptInjector;
    /**
     * @var {ThoughtsGenerationMetadataStorage}
     */
    _storage;
    /**
     * @type {Set<number>}
     */
    _hiddenMessageIds = new Set();

    /**
     * @param {ThoughtsTemplatePosition} templatePosition
     * @param {ThinkingPrompt[]} thinkingPrompts
     * @param {number} characterId
     * @return {EmbeddedThoughtsGenerationPlan}
     */
    static createForTemplate(templatePosition, thinkingPrompts, characterId) {
        return new EmbeddedThoughtsGenerationPlan(
            thinkingPrompts,
            characterId,
            EmbeddedThoughtsUI.getInstance(),
            EmbeddedThoughtsPromptInjector.getInstance(),
            ThoughtsGenerationMetadataStorage.getInstanceForTemplate(templatePosition),
        );
    }

    constructor(thinkingPrompts, characterId, ui, promptInjector, storage) {
        this._thinkingPrompts = thinkingPrompts;
        this._characterId = characterId;
        this._ui = ui;
        this._promptInjector = promptInjector;
        this._storage = storage;
    }

    /**
     * @param {?number} characterId
     * @return {Promise<void>}
     */
    async hideThoughts(characterId = null) {
        const context = getContext();

        const forcedCharacterId = Number.isInteger(characterId) ? characterId : this.getCharacterId();
        const currentCharacter = context.characters[forcedCharacterId];
        if (!currentCharacter) {
            console.log('[Stepped Thinking] Unable to find a character for hiding thoughts');
            return;
        }
        const characterSettings = getCharacterSettings(forcedCharacterId);

        const isMindReaderCharacter = Boolean(characterSettings && characterSettings.is_mind_reader);

        const lastMessageIndex = context.chat.length - 1;
        if (!this._storage.isEmpty()) {
            await this.#hideLeadingMessages(lastMessageIndex);
        } else {
            await this.#revealLeadingMessages(lastMessageIndex);
        }

        for (let i = lastMessageIndex, revealedThoughtsCount = []; i >= 0 && (lastMessageIndex - i < settings.max_hiding_thoughts_lookup); i--) {
            const message = context.chat[i];

            revealedThoughtsCount[message.name] ??= this._hasThoughtsCountOffset(currentCharacter.name, message.name) ? 1 : 0;
            revealedThoughtsCount[message.name] += this.#revealThought(
                context.chat[i],
                revealedThoughtsCount[message.name],
                currentCharacter.name,
                isMindReaderCharacter,
            );
        }
    }

    /**
     * @param {string} generationType
     * @return {Promise<void>}
     */
    async prepareGenerationPrompt(generationType) {
        const context = getContext();
        this._promptInjector.purge();
        if (generationType === 'impersonate') {
            return;
        }

        const currentCharacterName = context.characters[this.getCharacterId()].name;
        const lastMessageId = context.chat.length - 1;
        for (let i = lastMessageId, j = lastMessageId; i >= 0 && (lastMessageId - i < settings.max_hiding_thoughts_lookup); i--) {
            const message = context.chat[i];
            if (message.character_thoughts && !message.character_thoughts.is_hidden) {
                await this._promptInjector.injectBound(message, lastMessageId - j + 1, currentCharacterName);
            }
            if (!message.is_system) {
                j--;
            }
        }

        const thoughtGeneration = this._storage.getThoughtsGeneration();
        if (thoughtGeneration) {
            await this._promptInjector.injectGenerating(thoughtGeneration, currentCharacterName, this._getMaxThoughtItemId());
        }
    }

    /**
     * @param {string} generatedThought
     * @param {ThinkingPrompt} thinkingPrompt
     * @return {Promise<void>}
     */
    async putCharacterThoughts(generatedThought, thinkingPrompt) {
        const thoughtGeneration = this._storage.getThoughtsGeneration();

        const newThought = {
            id: this._getNewThoughtId(thoughtGeneration),
            thought: generatedThought,
            thinkingPrompt: thinkingPrompt,
        };
        this._storage.addThoughtToGeneration(newThought);

        this._ui.addThoughtToContainer(thoughtGeneration.thoughts_id, newThought);

        if (this._isScrollChatOnPuttingThoughts()) {
            scrollChatToBottom();
        }
    }

    /**
     * @return {Promise<void>}
     */
    async saveCharacterThoughts() {
        const context = getContext();
        const generatedThoughts = this._storage.getThoughtsGeneration();
        if (!generatedThoughts) {
            return;
        }

        const messageId = this._storage.getTargetMessageId();
        const message = context.chat[messageId];

        message.character_thoughts = generatedThoughts;
        this._ui.bindThoughtsContainer(messageId, message.character_thoughts.thoughts_id);

        this._storage.reset();

        saveChatDebounced();
    }

    /**
     * @return {void}
     */
    orphanIntermediateUnboundThoughts() {
        const context = getContext();

        const targetMessageId = this._storage.getTargetMessageId();
        if (!Number.isInteger(targetMessageId) || context.chat[targetMessageId]) {
            return;
        }

        this._storage.reset();

        this._ui.unbindIntermediateThoughts();

        scrollChatToBottom();
    }

    /**
     * @return {ThinkingPrompt[]}
     */
    getThinkingPrompts() {
        return this._thinkingPrompts;
    }

    /**
     * @return {number}
     */
    getCharacterId() {
        return this._characterId;
    }

    /**
     * @param {number} lastMessageIndex
     * @return {Promise<void>}
     */
    async #hideLeadingMessages(lastMessageIndex) {
        const context = getContext();

        const promises = [];
        this._hiddenMessageIds = new Set();
        for (let i = lastMessageIndex; i >= this._getMessageId(); i--) {
            if (context.chat[i].is_system) {
                this._hiddenMessageIds.add(i);
            } else {
                promises.push(hideChatMessageRange(i, i, false));
            }
        }

        await Promise.all(promises);
    }

    /**
     * @param {number} lastMessageIndex
     * @return {Promise<void>}
     */
    async #revealLeadingMessages(lastMessageIndex) {
        const promises = [];
        for (let i = lastMessageIndex; i >= this._getMessageId(); i--) {
            if (!this._hiddenMessageIds.has(i)) {
                promises.push(hideChatMessageRange(i, i, true));
            }
        }

        await Promise.all(promises);
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
            this._ui.renderHidingState(message.character_thoughts.thoughts_id, characterThoughts.is_hidden);
        }

        return characterThoughts.is_hidden ? 0 : 1;
    }

    /**
     * @param {string} currentCharacterName
     * @param {string} characterName
     * @return {boolean}
     */
    _hasThoughtsCountOffset(currentCharacterName, characterName) {
        return currentCharacterName === characterName && !this._storage.isEmpty()
    }

    /**
     * @param {ThoughtsGeneration} thoughtGeneration
     * @return {number}
     */
    _getNewThoughtId(thoughtGeneration) {
        return thoughtGeneration.thoughts.length;
    }

    /**
     * @return {number}
     */
    _getMessageId() {
        const targetMessageId = this._storage.getTargetMessageId();
        return Number.isInteger(targetMessageId)
            ? targetMessageId
            : getContext().chat.length;
    }

    /**
     * @var {?number}
     */
    _getMaxThoughtItemId() {
        return null;
    }

    /**
     * @return {boolean}
     */
    _isScrollChatOnPuttingThoughts() {
        return true;
    }
}

export class EmbeddedThoughtsRefreshPlan extends EmbeddedThoughtsGenerationPlan {
    /**
     * @var {ThoughtPosition}
     */
    _position;

    /**
     * @param {ThoughtPosition} position
     * @return {EmbeddedThoughtsRefreshPlan}
     */
    static createForPosition(position) {
        const context = getContext();

        const messageId = EmbeddedThoughtsRefreshPlan.findMessageId(position);
        const characterName = context.chat[messageId].name;
        const thoughtsGeneration = context.chat[messageId].character_thoughts;

        return new EmbeddedThoughtsRefreshPlan(
            position,
            [thoughtsGeneration.thoughts[position.thoughtItemId].thinkingPrompt],
            context.characters.findIndex(character => character.name === characterName),
            EmbeddedThoughtsUI.getInstance(),
            EmbeddedThoughtsPromptInjector.getInstance(),
            ThoughtsGenerationMetadataStorage.getInstanceWithGeneration(
                messageId,
                thoughtsGeneration,
            ),
        );
    }

    /**
     * @param {ThoughtPosition} position
     * @return {number}
     */
    static findMessageId(position) {
        const context = getContext();
        return context.chat.findIndex(message => message.character_thoughts?.thoughts_id === position.thoughtsId);
    }

    constructor(position, thinkingPrompts, characterId, ui, promptInjector, storage) {
        super(thinkingPrompts, characterId, ui, promptInjector, storage);
        this._position = position;
    }

    /**
     * @return {ThinkingPrompt[]}
     */
    getThinkingPrompts() {
        const thoughtsGeneration = this._storage.getThoughtsGeneration();
        const thought = thoughtsGeneration.thoughts.find(thought => thought.id === this._position.thoughtItemId);

        return [thought.thinkingPrompt];
    }

    /**
     * @var {?number}
     */
    _getMaxThoughtItemId() {
        return this._position.thoughtItemId;
    }

    /**
     * @param {string} currentCharacterName
     * @param {string} characterName
     * @return {boolean}
     */
    _hasThoughtsCountOffset(currentCharacterName, characterName) {
        return false;
    }

    /**
     * @param {ThoughtsGeneration} thoughtGeneration
     * @return {number}
     */
    _getNewThoughtId(thoughtGeneration) {
        return this._position.thoughtItemId;
    }

    /**
     * @return {number}
     */
    _getMessageId() {
        const targetMessageId = this._storage.getTargetMessageId();
        return Number.isInteger(targetMessageId)
            ? targetMessageId
            : EmbeddedThoughtsRefreshPlan.findMessageId(this._position);
    }

    /**
     * @return {boolean}
     */
    _isScrollChatOnPuttingThoughts() {
        return false;
    }
}

export class EmbeddedThoughtsDefaultPlan extends EmbeddedThoughtsGenerationPlan {
    constructor() {
        super(
            [],
            null,
            EmbeddedThoughtsUI.getInstance(),
            EmbeddedThoughtsPromptInjector.getInstance(),
            ThoughtsGenerationMetadataStorage.getInstance(),
        );
    }

    /**
     * @param {string} generatedThought
     * @param {ThinkingPrompt} thinkingPrompt
     * @return {Promise<void>}
     */
    async putCharacterThoughts(generatedThought, thinkingPrompt) {
        console.warn('[Stepped Thinking] Cannot use EmbeddedThoughtsDefaultPlan for thoughts generation');
    }

    /**
     * @return {number}
     */
    getCharacterId() {
        return getContext().characterId;
    }

    /**
     * @param {string} currentCharacterName
     * @param {string} characterName
     * @return {boolean}
     */
    _hasThoughtsCountOffset(currentCharacterName, characterName) {
        return false;
    }

    /**
     * @return {number}
     */
    _getMessageId() {
        return getContext().chat.length;
    }
}

export class EmbeddedThoughtsEditing extends ThoughtsEditing {
    /**
     * @var {EmbeddedThoughtsUI}
     */
    _ui;
    /**
     * @var {ThoughtPosition}
     */
    _position;

    /**
     * @param {string} thoughtsId
     * @param {Thought} thought
     * @return {ThoughtsEditing}
     */
    static createForThought(thoughtsId, thought) {
        return new EmbeddedThoughtsEditing(
            ThoughtsEditingStaticStorage.getInstance(),
            EmbeddedThoughtsUI.getInstance(),
            new ThoughtPosition(thoughtsId, thought.id),
        );
    }

    constructor(storage, ui, position) {
        super(storage);
        this._ui = ui;
        this._position = position;
    }

    /**
     * @return {void}
     */
    startEditing() {
        this._ui.makeThoughtEditable(
            this._position.thoughtsId,
            this.#findThought(this._position),
        );
    }

    /**
     * @return {Promise<void>}
     */
    async applyEdits() {
        const context = getContext();

        const thought = this.#findThought(this._position);
        if (!thought) {
            return;
        }
        const result = this._ui.getThoughtText(this._position);
        if (!result) {
            return;
        }

        thought.thought = result;
        this._ui.renderThought(this._position.thoughtsId, thought);

        await context.saveChat();
    }

    /**
     * @return {void}
     */
    cancelEdits() {
        this._ui.renderThought(
            this._position.thoughtsId,
            this.#findThought(this._position),
        );
    }

    /**
     * @param {ThoughtPosition} position
     * @return {?Thought}
     */
    #findThought(position) {
        const context = getContext();
        const chatMessage = context.chat.find(message => message.character_thoughts?.thoughts_id === position.thoughtsId);
        if (!chatMessage) {
            return null;
        }

        return chatMessage.character_thoughts.thoughts.find(thought => thought.id === position.thoughtItemId);
    }
}

export class EmbeddedThoughtsPromptInjector {
    EXTENSION_PROMPT_PREFIX = 'STEPTHINK_THOUGHT_';

    /**
     * @var {EmbeddedThoughtsPromptInjector}
     */
    static #instance;
    /**
     * @var {EmbeddedThoughtsPromptTemplate}
     */
    _template;

    static getInstance() {
        if (!EmbeddedThoughtsPromptInjector.#instance) {
            EmbeddedThoughtsPromptInjector.#instance = new EmbeddedThoughtsPromptInjector(
                EmbeddedThoughtsPromptTemplate.getInstance()
            );
        }

        return EmbeddedThoughtsPromptInjector.#instance;
    }

    constructor(template) {
        this._template = template;
    }

    /**
     * @param {object} message
     * @param {number} depth
     * @param {string} currentCharacterName
     * @return {Promise<void>}
     */
    async injectBound(message, depth, currentCharacterName) {
        if (message.name === currentCharacterName) {
            await this._injectThoughts(message.character_thoughts, currentCharacterName, depth, message.character_thoughts.thoughts_id);
        } else {
            await this._injectThoughts(message.character_thoughts, message.name, depth, message.character_thoughts.thoughts_id);
        }
    }

    /**
     * @param {ThoughtsGeneration} thoughtGeneration
     * @param {string} currentCharacterName
     * @param {?number} maxThoughtItemId
     * @return {Promise<void>}
     */
    async injectGenerating(thoughtGeneration, currentCharacterName, maxThoughtItemId = null) {
        await this._injectThoughts(thoughtGeneration, currentCharacterName, 0, thoughtGeneration.thoughts_id, maxThoughtItemId);
    }

    /**
     * @return {void}
     */
    purge() {
        for (const key of Object.keys(extension_prompts)) {
            if (key.startsWith(this.EXTENSION_PROMPT_PREFIX)) {
                delete extension_prompts[key];
            }
        }
    }

    /**
     * @param {ThoughtsGeneration} generatedThoughts
     * @param {string} characterName
     * @param {number} depth
     * @param {string} thoughtsId
     * @param {?number} maxThoughtItemId
     * @return {Promise<void>}
     */
    async _injectThoughts(generatedThoughts, characterName, depth, thoughtsId, maxThoughtItemId = null) {
        const injectionRole = settings.sending_thoughts_role;
        const thoughtPrompt = this._template.render(
            generatedThoughts,
            characterName,
            injectionRole,
            settings.thoughts_prefix_injection_mode,
            maxThoughtItemId
        );

        setExtensionPrompt(
            `${this.EXTENSION_PROMPT_PREFIX}_${thoughtsId}`,
            await adjustPromptForCharacter(thoughtPrompt, characterName),
            extension_prompt_types.IN_CHAT,
            depth,
            true,
            injectionRole,
        );
    }
}

export class EmbeddedThoughtsPromptTemplate {
    /**
     * @var {EmbeddedThoughtsPromptTemplate}
     */
    static #instance;

    static getInstance() {
        if (!EmbeddedThoughtsPromptTemplate.#instance) {
            EmbeddedThoughtsPromptTemplate.#instance = new EmbeddedThoughtsPromptTemplate();
        }

        return EmbeddedThoughtsPromptTemplate.#instance;
    }

    /**
     * @param {ThoughtsGeneration} generatedThoughts
     * @param {string} characterName
     * @param {number} injectionRole
     * @param {string} injectionMode
     * @param {?number} maxThoughtItemId
     * @return {string}
     */
    render(generatedThoughts, characterName, injectionRole, injectionMode, maxThoughtItemId = null) {
        const prefix = this.#renderPrefix(injectionRole, injectionMode);
        const thoughts = this.#renderThoughts(generatedThoughts, maxThoughtItemId);

        return settings.general_injection_template
            .replaceAll('{{prefix}}', prefix)
            .replaceAll('{{thoughts}}', thoughts)
            .replaceAll('{{char}}', characterName);
    }

    /**
     * @param {ThoughtsGeneration} generatedThoughts
     * @param {?number} maxThoughtItemId
     * @return {string}
     */
    #renderThoughts(generatedThoughts, maxThoughtItemId = null) {
        const thoughtsLastIndex = generatedThoughts.thoughts.length - 1;

        return generatedThoughts.thoughts.reduce(
            (result, currentThought, index) => {
                if (Number.isInteger(maxThoughtItemId) && currentThought.id >= maxThoughtItemId) {
                    return result;
                }

                return result
                    + settings.thought_injection_template
                        .replaceAll('{{thought}}', currentThought.thought)
                        .replaceAll('{{prompt_name}}', currentThought.thinkingPrompt.name)
                        .replaceAll('{{prompt_name.toLowerCase()}}', currentThought.thinkingPrompt.name.toLowerCase())
                    + (index !== thoughtsLastIndex ? settings.thought_injection_separator : '');
            },
            '',
        );

    }

    /**
     * @param {number} injectionRole
     * @param {string} injectionMode
     * @return {string}
     */
    #renderPrefix(injectionRole, injectionMode) {
        const context = getContext();

        let mode = injectionMode;
        if (mode === thoughtPrefixInjectionModes.FROM_INSTRUCT) {
            mode = this.#importPrefixModeFromInstruct(injectionRole);
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
     * @param {number} injectionRole
     * @return {string}
     */
    #importPrefixModeFromInstruct(injectionRole) {
        const context = getContext();
        if (context.mainApi === 'openai') {
            return this.#importPrefixModeForChatCompletion();
        }

        return this.#importPrefixModeForTextCompletion(injectionRole);
    }

    /**
     * @return {string}
     */
    #importPrefixModeForChatCompletion() {
        switch (oai_settings.names_behavior) {
            case -1: // NONE
                return thoughtPrefixInjectionModes.NEVER;
            case 0: // DEFAULT
                return thoughtPrefixInjectionModes.GROUPS;
            case 1: // COMPLETION
                return thoughtPrefixInjectionModes.NEVER;
            case 2: // CONTENT
                return thoughtPrefixInjectionModes.ALWAYS;
        }
    }

    /**
     * @param {number} injectionRole
     * @return {string}
     */
    #importPrefixModeForTextCompletion(injectionRole) {
        if (power_user.instruct.enabled && power_user.instruct.names_behavior === names_behavior_types.NONE) {
            return thoughtPrefixInjectionModes.NEVER;
        }

        if (injectionRole === extension_prompt_roles.SYSTEM) {
            return thoughtPrefixInjectionModes.ALWAYS;
        }

        return thoughtPrefixInjectionModes.NEVER;
    }
}

export class EmbeddedThoughtsUI {
    /**
     * @var {EmbeddedThoughtsUI}
     */
    static #instance;

    /**
     * @var {EmbeddedThoughtsThoughtElementUI}
     */
    _thoughtUi;

    static getInstance() {
        if (!EmbeddedThoughtsUI.#instance) {
            EmbeddedThoughtsUI.#instance = new EmbeddedThoughtsUI(
                EmbeddedThoughtsThoughtElementUI.getInstance()
            );
        }

        return EmbeddedThoughtsUI.#instance;
    }

    constructor(thoughtsUi) {
        this._thoughtUi = thoughtsUi;
    }

    /**
     * @param {string} thoughtsId
     * @param {string} title
     * @param {function(string): Promise<void>} deleteThoughts
     * @return {void}
     */
    createThoughtsContainerTemplate(thoughtsId, title, deleteThoughts) {
        const thoughtsTemplate = this.#createThoughtsContainer(thoughtsId, title, deleteThoughts);
        thoughtsTemplate.classList.add('intermediate_thoughts');

        const lastMessage = $('#chat .mes').last();
        lastMessage.removeClass('last_mes');
        lastMessage.after(thoughtsTemplate);
    }

    /**
     * @param {string} thoughtsId
     * @param {Thought} thought
     * @return {void}
     */
    addThoughtToContainer(thoughtsId, thought) {
        const thoughtsContainer = this.#findThoughtsContainer(thoughtsId);
        this._thoughtUi.addThoughtToContainer(
            this.#findThoughtItemsContainer(thoughtsContainer),
            thoughtsId,
            thought
        );
    }

    /**
     * @param {int} messageIdToBind
     * @param {string} thoughtsId
     */
    bindThoughtsContainer(messageIdToBind, thoughtsId) {
        const thoughtsContainer = this.#findThoughtsContainer(thoughtsId);
        thoughtsContainer.classList.remove('intermediate_thoughts');

        const messageElement = document.querySelector(`#chat .mes[mesid="${messageIdToBind}"]`);
        this.#bindMessageToThoughts(messageElement, thoughtsId);
    }

    /**
     * @param {string} thoughtsId
     * @param {boolean} isHidden
     * @return {void}
     */
    renderHidingState(thoughtsId, isHidden) {
        const thoughtsContainer = this.#findThoughtsContainer(thoughtsId);
        if (thoughtsContainer) {
            this.#renderHidingState(thoughtsContainer, isHidden);
        }
    }

    /**
     * @return {void}
     */
    removeUnboundThoughts() {
        $('#chat .thoughts').each((_, thoughtsContainer) => {
            const thoughtsId = thoughtsContainer.getAttribute('thoughts_id');
            const boundMessageElement = document.querySelector(`#chat .mes[thoughts_id="${thoughtsId}"]`);
            if (!boundMessageElement) {
                thoughtsContainer.remove();
            }
        });
    }

    /**
     * @param {string} thoughtsId
     * @return {void}
     */
    removeThoughtsContainer(thoughtsId) {
        const thoughtsContainer = this.#findThoughtsContainer(thoughtsId);
        if (thoughtsContainer) {
            thoughtsContainer.remove();
        }
    }

    /**
     * @param {object[]} chat
     * @param {function(string): Promise<void>} deleteThoughts
     * @return {void}
     */
    renderThoughts(chat, deleteThoughts) {
        $('#chat .mes').each((_, messageElement) => {
            if (messageElement.getAttribute('thoughts_rendered') === 'true') {
                this.#reattachDetachedThoughtContainer(messageElement);
                return;
            }

            const messageId = messageElement.getAttribute('mesid');
            const thoughtsGeneration = chat[messageId].character_thoughts;
            if (!thoughtsGeneration) {
                messageElement.setAttribute('thoughts_rendered', 'true');
                return;
            }

            const thoughtsContainer = this.#createThoughtsContainer(
                thoughtsGeneration.thoughts_id,
                thoughtsGeneration.title,
                deleteThoughts
            );
            this.#renderHidingState(thoughtsContainer, thoughtsGeneration.is_hidden);
            for (const thought of thoughtsGeneration.thoughts) {
                this._thoughtUi.addThoughtToContainer(
                    this.#findThoughtItemsContainer(thoughtsContainer),
                    thoughtsGeneration.thoughts_id,
                    thought
                );
            }

            messageElement.before(thoughtsContainer);
            this.#bindMessageToThoughts(messageElement, thoughtsGeneration.thoughts_id);
        });
    }

    /**
     * @return {void}
     */
    unbindIntermediateThoughts() {
        const lastThoughtContainer = document.querySelector('.intermediate_thoughts');
        if (!lastThoughtContainer) {
            return;
        }

        lastThoughtContainer.classList.remove('intermediate_thoughts');
        lastThoughtContainer.classList.add('unbound_thoughts');

        $('#chat .mes').last().addClass('last_mes');
    }

    /**
     * @return {void}
     */
    purgeUnboundThoughts() {
        document.querySelector('.unbound_thoughts')?.remove();
    }

    /**
     * @param {string} thoughtsId
     * @param {Thought} thought
     * @return {void}
     */
    makeThoughtEditable(thoughtsId, thought) {
        const thoughtsContainer = this.#findThoughtsContainer(thoughtsId);
        this._thoughtUi.makeThoughtEditable(
            this.#findThoughtItemsContainer(thoughtsContainer),
            thought
        );
    }

    /**
     * @param {string} thoughtsId
     * @param {Thought} thought
     * @return {void}
     */
    renderThought(thoughtsId, thought) {
        const thoughtsContainer = this.#findThoughtsContainer(thoughtsId);
        this._thoughtUi.renderThought(
            this.#findThoughtItemsContainer(thoughtsContainer),
            thought
        );
    }

    /**
     * @param {ThoughtPosition} position
     * @return {?string}
     */
    getThoughtText(position) {
        const thoughtsContainer = this.#findThoughtsContainer(position.thoughtsId);
        return this._thoughtUi.getThoughtTextAreaContent(
            this.#findThoughtItemsContainer(thoughtsContainer),
            position.thoughtItemId
        );
    }

    /**
     * This is a crutch required to fix detached thought blocks problem after clicking the "Show more messages" button
     *
     * @param {HTMLDivElement} messageElement
     * @return {void}
     */
    #reattachDetachedThoughtContainer(messageElement) {
        const messageThoughtsId = messageElement.getAttribute('thoughts_id');
        if (!messageThoughtsId) {
            return;
        }

        const boundThoughtsContainer = this.#findThoughtsContainer(messageThoughtsId);
        if (boundThoughtsContainer) {
            messageElement.before(boundThoughtsContainer);
        }
    }

    /**
     * @param {string} thoughtsId
     * @param {string} title
     * @param {function(string): Promise<void>} deleteThoughts
     * @return {HTMLDivElement}
     */
    #createThoughtsContainer(thoughtsId, title, deleteThoughts) {
        const thoughtsContainer = document.createElement('div');
        thoughtsContainer.setAttribute('id', `thoughts_mes--${thoughtsId}`);
        thoughtsContainer.setAttribute('thoughts_id', thoughtsId);
        thoughtsContainer.classList.add('thoughts');

        const detailsElement = document.createElement('div');
        if (settings.is_thoughts_spoiler_open) {
            detailsElement.classList.add('thoughts_open');
        }
        detailsElement.classList.add('thoughts_details');

        const summaryElement = this.#createThoughtsSummaryElement(detailsElement, thoughtsId, title, deleteThoughts);

        const thoughtItemsContainer = document.createElement('div');
        thoughtItemsContainer.classList.add('thought_items');

        detailsElement.append(summaryElement, thoughtItemsContainer);
        thoughtsContainer.append(detailsElement);

        return thoughtsContainer;
    }

    /**
     * @param {HTMLDivElement} detailsElement
     * @param {string} thoughtsId
     * @param {string} title
     * @param {function(string): Promise<void>} deleteThoughts
     * @return {HTMLElement}
     */
    #createThoughtsSummaryElement(detailsElement, thoughtsId, title, deleteThoughts) {
        const summaryElement = document.createElement('div');
        summaryElement.classList.add('thought_summary');

        const summaryContainer = document.createElement('div');
        summaryContainer.classList.add('thought_summary_container');
        summaryContainer.addEventListener('click', (event) => {
            if (event.defaultPrevented) {
                return;
            }
            detailsElement.classList.toggle('thoughts_open');
        });

        const titleElement = document.createElement('div');
        titleElement.classList.add('flex1');
        if (title !== null) {
            titleElement.innerHTML = `<b>${title}</b>&nbsp;`;
        }
        titleElement.innerHTML += '<i class="mes_ghost fa-solid fa-ghost" title="These thoughts won\'t be included in the prompt" style="display: none"></i>';

        const buttonsContainer = document.createElement('div');
        buttonsContainer.classList.add('thought_control_buttons');

        const deleteButton = document.createElement('div');
        deleteButton.classList.add('mes_button', 'fa-solid', 'fa-trash-can', 'interactable');
        deleteButton.addEventListener('click', async (event) => {
            event.preventDefault();
            await deleteThoughts(thoughtsId);

            await hideThoughts();
        });

        buttonsContainer.append(deleteButton);
        summaryContainer.append(titleElement, buttonsContainer);
        summaryElement.append(summaryContainer);

        return summaryElement;
    }

    /**
     * @param {string} thoughtsId
     * @return {HTMLDivElement}
     */
    #findThoughtsContainer(thoughtsId) {
        return document.getElementById(`thoughts_mes--${thoughtsId}`);
    }

    /**
     * @param {HTMLDivElement} thoughtsContainer
     * @return {HTMLDivElement}
     */
    #findThoughtItemsContainer(thoughtsContainer) {
        return thoughtsContainer.querySelector('.thought_items');
    }

    /**
     * @param {HTMLDivElement} messageElement
     * @param {string} thoughtsId
     * @return {void}
     */
    #bindMessageToThoughts(messageElement, thoughtsId) {
        messageElement.setAttribute('thoughts_rendered', 'true');
        messageElement.setAttribute('thoughts_id', thoughtsId);
    }

    /**
     * @param {HTMLDivElement} thoughtsContainer
     * @param {boolean} isHidden
     * @return {void}
     */
    #renderHidingState(thoughtsContainer, isHidden) {
        const ghostIcon = thoughtsContainer.querySelector('.thought_summary .mes_ghost');

        if (isHidden) {
            ghostIcon.style.display = '';
        } else {
            ghostIcon.style.display = 'none';
        }
    }
}

export class EmbeddedThoughtsThoughtElementUI {
    static TEXTAREA_HEIGHT_OFFSET_PX = 5;

    /**
     * @var {EmbeddedThoughtsThoughtElementUI}
     */
    static #instance;

    static getInstance() {
        if (!EmbeddedThoughtsThoughtElementUI.#instance) {
            EmbeddedThoughtsThoughtElementUI.#instance = new EmbeddedThoughtsThoughtElementUI();
        }

        return EmbeddedThoughtsThoughtElementUI.#instance;
    }

    /**
     * @param {HTMLDivElement} thoughtItemsContainer
     * @param {string} thoughtsId
     * @param {Thought} thought
     * @return {void}
     */
    addThoughtToContainer(thoughtItemsContainer, thoughtsId, thought) {
        const existingThoughtTextElement = this.#findThoughtTextElement(thoughtItemsContainer, thought.id);
        if (existingThoughtTextElement) {
            this.#insertThoughtText(existingThoughtTextElement, thought.thought);
            return;
        }

        const thoughtContainer = document.createElement('div');
        const thoughtNameContainer = this.#createThoughtNameContainer(
            thoughtsId,
            thought,
            EmbeddedThoughtsEditing.createForThought(thoughtsId, thought),
        );

        const thoughtTextElement = document.createElement('div');
        thoughtTextElement.setAttribute('id', `generated_thought--${thought.id}`);
        thoughtTextElement.setAttribute('generated_thought_id', String(thought.id));
        thoughtTextElement.classList.add('mes_text', 'generated_thought');

        this.#insertThoughtText(thoughtTextElement, thought.thought);

        thoughtContainer.append(thoughtNameContainer, thoughtTextElement);
        thoughtItemsContainer.append(thoughtContainer);
    }

    /**
     * @param {HTMLDivElement} thoughtItemsContainer
     * @param {Thought} thought
     * @return {void}
     */
    makeThoughtEditable(thoughtItemsContainer, thought) {
        const thoughtTextElement = this.#findThoughtTextElement(thoughtItemsContainer, thought.id);
        const buttonsContainer = this.#findThoughtButtonsContainer(thoughtItemsContainer, thought.id);

        this.#revealControlButtonsByClass(buttonsContainer, 'thought_edit_mode_button');

        const textArea = document.createElement('textarea');
        textArea.value = thought.thought;
        textArea.addEventListener('input', function () {
            this.style.height = "";
            this.style.height = EmbeddedThoughtsThoughtElementUI.TEXTAREA_HEIGHT_OFFSET_PX + this.scrollHeight + "px";
        });

        thoughtTextElement.innerHTML = '';
        thoughtTextElement.append(textArea);

        textArea.style.height = EmbeddedThoughtsThoughtElementUI.TEXTAREA_HEIGHT_OFFSET_PX + textArea.scrollHeight + "px";
        textArea.focus();
    }

    /**
     * @param {HTMLDivElement} thoughtItemsContainer
     * @param {Thought} thought
     * @return {void}
     */
    renderThought(thoughtItemsContainer, thought) {
        const thoughtTextElement = this.#findThoughtTextElement(thoughtItemsContainer, thought.id);
        const buttonsContainer = this.#findThoughtButtonsContainer(thoughtItemsContainer, thought.id);

        this.#revealControlButtonsByClass(buttonsContainer, 'thought_observe_mode_button');

        this.#insertThoughtText(thoughtTextElement, thought.thought);
    }

    /**
     * @param {HTMLDivElement} thoughtItemsContainer
     * @param {number} thoughtItemId
     * @return {?string}
     */
    getThoughtTextAreaContent(thoughtItemsContainer, thoughtItemId) {
        const thoughtTextElement = this.#findThoughtTextElement(thoughtItemsContainer, thoughtItemId);
        const textArea = thoughtTextElement.querySelector('textarea');
        if (!textArea) {
            return null;
        }

        return thoughtTextElement.querySelector('textarea').value;
    }

    /**
     * @param {string} thoughtsId
     * @param {Thought} thought
     * @param {ThoughtsEditing} editing
     * @return {HTMLDivElement}
     */
    #createThoughtNameContainer(thoughtsId, thought, editing) {
        const thoughtNameContainer = document.createElement('div');
        thoughtNameContainer.classList.add('generated_thought_name', 'flex-container', 'justifySpaceBetween', 'flexFlowRow');

        const thoughtNameElement = document.createElement('div');
        thoughtNameElement.innerHTML = thought.thinkingPrompt.name;

        const buttonsContainer = document.createElement('div');
        buttonsContainer.classList.add('thought_control_buttons');
        buttonsContainer.setAttribute('generated_thought_id', String(thought.id));

        const editButton = document.createElement('div');
        editButton.classList.add('mes_button', 'fa-solid', 'fa-pencil', 'interactable', 'thought_observe_mode_button');
        editButton.addEventListener('click', editing.onStartEditing());

        const refreshButton = document.createElement('div');
        refreshButton.classList.add('mes_button', 'fa-solid', 'fa-rotate', 'interactable', 'thought_observe_mode_button');
        refreshButton.addEventListener('click', () => runRefreshGeneratedThoughts(new ThoughtPosition(thoughtsId, thought.id)));

        const cancelButton = document.createElement('div');
        cancelButton.classList.add('menu_button', 'fa-solid', 'fa-xmark', 'interactable', 'thought_edit_cancel_button', 'thought_edit_mode_button');
        cancelButton.addEventListener('click', editing.onCancelEdits());

        const doneButton = document.createElement('div');
        doneButton.classList.add('menu_button', 'fa-solid', 'fa-check', 'interactable', 'thought_edit_done_button', 'thought_edit_mode_button');
        doneButton.addEventListener('click', editing.onApplyEdits());

        buttonsContainer.append(editButton, refreshButton, doneButton, cancelButton);
        this.#revealControlButtonsByClass(buttonsContainer, 'thought_observe_mode_button');

        thoughtNameContainer.append(thoughtNameElement, buttonsContainer);

        return thoughtNameContainer;
    }

    /**
     * @param {HTMLDivElement} buttonsContainer
     * @param {string} classToReveal
     * @return {void}
     */
    #revealControlButtonsByClass(buttonsContainer, classToReveal) {
        for (const button of buttonsContainer.children) {
            if (button.classList.contains(classToReveal)) {
                button.style.display = '';
            } else {
                button.style.display = 'none';
            }
        }
    }

    /**
     * @param {HTMLDivElement} thoughtTextElement
     * @param {string} text
     * @return {void}
     */
    #insertThoughtText(thoughtTextElement, text) {
        const context = getContext();
        thoughtTextElement.innerHTML = context.messageFormatting(text, '', false, false, -1);
    }

    /**
     * @param {HTMLDivElement} thoughtItemsContainer
     * @param {number} thoughtItemId
     * @return {HTMLDivElement}
     */
    #findThoughtTextElement(thoughtItemsContainer, thoughtItemId) {
        return thoughtItemsContainer.querySelector(`.generated_thought[generated_thought_id="${thoughtItemId}"]`);
    }

    /**
     * @param {HTMLDivElement} thoughtContainer
     * @param {number} generatedThoughtId
     * @return {HTMLDivElement}
     */
    #findThoughtButtonsContainer(thoughtContainer, generatedThoughtId) {
        return thoughtContainer.querySelector(`.thought_control_buttons[generated_thought_id="${generatedThoughtId}"]`);
    }
}
