import { event_types, eventSource, extension_prompt_roles } from '../../../../../script.js';
import { formatInstructModeChat } from '../../../../instruct-mode.js';
import { settings } from '../settings/settings.js';
import { getContext } from '../../../../extensions.js';
import { oai_settings } from '../../../../openai.js';
import { power_user } from '../../../../power-user.js';

const DUMMY_SYMBOL = '۞'; // rare symbol, costs 2 tokens for popular models: https://www.prompttokencounter.com/
const DUMMY_SYMBOL_TOKEN_SIZE = 2;

/**
 * @type {[{actual: string, desired: string}]}
 */
let textCompletionAdjustments = [];
/**
 * @type {[{actual: string, desired: string, name: string}]}
 */
let chatCompletionAdjustments = [];

export function registerPromptAdjustmentListeners() {
    eventSource.makeFirst(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, event => {
        for (const completion of textCompletionAdjustments) {
            const mes = event.finalMesSend.find(mes => mes.message.trim() === completion.actual.trim());
            if (!mes) {
                console.warn(`[Stepped Thinking] Cannot find the expected prompt injection: ${completion.actual}`);
                continue;
            }

            mes.message = completion.desired;
        }

        textCompletionAdjustments = [];
    });

    eventSource.makeFirst(event_types.CHAT_COMPLETION_PROMPT_READY, event => {
        for (const completion of chatCompletionAdjustments) {
            const mes = event.chat.find(mes => mes.content.trim() === completion.actual.trim());
            if (!mes) {
                console.warn(`[Stepped Thinking] Cannot find the expected prompt injection: ${completion.actual}`);
                continue;
            }

            mes.content = completion.desired;
            mes.name = completion.name;
        }

        chatCompletionAdjustments = [];
    });

    eventSource.on(event_types.GENERATION_STOPPED, () => resetPromptAdjustments);
}

/**
 * @return {void}
 */
export function resetPromptAdjustments() {
    textCompletionAdjustments = [];
    chatCompletionAdjustments = [];
}

/**
 * @param {string} thoughtPrompt
 * @param {string} ownerCharacterName
 * @return {Promise<string>}
 */
export async function adjustPromptForCharacter(thoughtPrompt, ownerCharacterName) {
    const context = getContext();
    if (context.mainApi === 'openai') {
        return await addChatCompletionAdjustment(thoughtPrompt, ownerCharacterName);
    } else {
        return await addTextCompletionAdjustment(thoughtPrompt, ownerCharacterName);
    }
}

/**
 * @param {string} thoughtPrompt
 * @param {string} ownerCharacterName
 * @return {Promise<string>}
 */
async function addTextCompletionAdjustment(thoughtPrompt, ownerCharacterName) {
    const context = getContext();
    if (ownerCharacterName === context.name2) {
        return thoughtPrompt;
    }

    const actualPrompt = formatTextCompletionThought(context.name2, thoughtPrompt);
    const desiredPrompt = formatTextCompletionThought(ownerCharacterName, thoughtPrompt);

    if (actualPrompt === desiredPrompt) {
        return thoughtPrompt;
    }

    // Preventing context overflow. It is easier to increase the length than recalculate the prompt size afterward
    let thoughtExpandedPrompt = thoughtPrompt;
    let actualExpandedPrompt = actualPrompt;

    const actualPromptTokenCount = await context.getTokenCountAsync(actualPrompt);
    const desiredPromptTokenCount = await context.getTokenCountAsync(desiredPrompt);
    if (actualPromptTokenCount < desiredPromptTokenCount) {
        thoughtExpandedPrompt += getExpansionToMatchDesiredTokenCount(actualPromptTokenCount, desiredPromptTokenCount);
        actualExpandedPrompt = formatTextCompletionThought(context.name2, thoughtExpandedPrompt);
    }

    textCompletionAdjustments.push({ actual: actualExpandedPrompt, desired: desiredPrompt });

    return thoughtExpandedPrompt;
}

async function addChatCompletionAdjustment(thoughtPrompt, ownerCharacterName) {
    const context = getContext();

    // COMPLETION
    if (oai_settings.names_behavior !== 1) {
        return thoughtPrompt;
    }

    const actualShortPrompt = JSON.stringify({ content: thoughtPrompt });
    const desiredShortPrompt = JSON.stringify({ content: thoughtPrompt, name: ownerCharacterName });

    // Preventing context overflow. It is easier to increase the length than recalculate the prompt size afterward
    const actualPromptTokenCount = await context.getTokenCountAsync(actualShortPrompt);
    const desiredPromptTokenCount = await context.getTokenCountAsync(desiredShortPrompt);
    const thoughtExpandedPrompt = thoughtPrompt + getExpansionToMatchDesiredTokenCount(actualPromptTokenCount, desiredPromptTokenCount);

    chatCompletionAdjustments.push({ actual: thoughtExpandedPrompt, desired: thoughtPrompt, name: ownerCharacterName });

    return thoughtExpandedPrompt;
}

/**
 * @param {number} actualPromptTokenCount
 * @param {number} desiredPromptTokenCount
 * @return {string}
 */
function getExpansionToMatchDesiredTokenCount(actualPromptTokenCount, desiredPromptTokenCount) {
    const difference = desiredPromptTokenCount - actualPromptTokenCount;
    return DUMMY_SYMBOL.repeat(Math.ceil(difference / DUMMY_SYMBOL_TOKEN_SIZE));
}

/**
 * @param {string} characterName
 * @param {string} thoughtPrompt
 * @return {string}
 */
function formatTextCompletionThought(characterName, thoughtPrompt) {
    if (!power_user.instruct.enabled) {
        if (settings.sending_thoughts_role === extension_prompt_roles.SYSTEM) {
            return thoughtPrompt;
        }

        return `${characterName}: ${thoughtPrompt}\n`;
    }

    return formatInstructModeChat(
        characterName,
        thoughtPrompt,
        settings.sending_thoughts_role === extension_prompt_roles.USER,
        settings.sending_thoughts_role === extension_prompt_roles.SYSTEM,
        '',
        getContext().name1,
        characterName,
        false,
    );
}
