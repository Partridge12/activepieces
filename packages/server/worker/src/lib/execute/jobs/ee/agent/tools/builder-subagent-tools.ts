import { AIProviderName, isNil, isObject } from '@activepieces/core-utils'
import { agentToolClassification, PersistedAgentPart, PersistedAgentPartType, PersistedToolCallStatus, SubagentActivity, SubagentStep } from '@activepieces/shared'
import { LanguageModel, tool, ToolSet } from 'ai'
import { z } from 'zod'
import { AgentTurnResult, runAgentTurn, RunAgentTurnParams } from '../run-agent-turn'
import { AgentEventEmitter } from './tool-primitives'

export function createBuilderSubagentTools({ tools, model, provider, tier, modelId, builderPrompt, buildGuide, creditsLeft, eventEmitter, abortSignal, log }: {
    tools: ToolSet
    model: LanguageModel
    provider: AIProviderName
    tier: RunAgentTurnParams['tier']
    modelId: string
    builderPrompt: string | undefined
    buildGuide: string
    creditsLeft: RunAgentTurnParams['creditsLeft']
    eventEmitter: AgentEventEmitter
    abortSignal: AbortSignal
    log: RunAgentTurnParams['log']
}): ToolSet {
    const builderTools = Object.fromEntries(Object.entries(tools).filter(([name]) => BUILDER_TOOL_NAMES.includes(name)))
    if (!(BUILD_TOOL_NAME in builderTools) || isNil(builderPrompt)) {
        return {}
    }
    return {
        [BUILDER_TOOL_NAME]: tool({
            description: 'Hand one flow of a solution to a builder that works in its own context and returns a short report (flowId, externalId, steps, validation, open issues). Call it several times in the same step to build independent flows in parallel. The brief must be self-contained: the builder sees nothing of this conversation.',
            inputSchema: builderInput,
            execute: async ({ flowName, brief, flowId }, { toolCallId }) => {
                const startedAt = new Date()
                const report = (activity: SubagentActivity) => eventEmitter.emitSubagentProgress({ toolCallId, data: activity })
                report({ flowName, status: 'running', steps: [], startedAt: startedAt.toISOString() })
                const turn = await runAgentTurn({
                    model,
                    provider,
                    systemPrompt: `${builderPrompt}\n\n# Build reference\n\n${buildGuide}`,
                    messages: [{ role: 'user', content: builderTask({ flowName, brief, flowId }) }],
                    tools: builderTools,
                    allToolNames: Object.keys(builderTools),
                    tier,
                    modelId,
                    phaseState: { phase: 'build' },
                    abortSignal,
                    log,
                    creditsLeft,
                    sinks: {
                        drainStream: async (result) => {
                            await result.consumeStream()
                        },
                        onProgress: ({ uiParts }) => report({ flowName, status: 'running', steps: stepsFrom(uiParts), pieces: piecesFrom(uiParts), startedAt: startedAt.toISOString() }),
                    },
                })
                const result = builderResult({ flowName, turn, startedAt })
                report(result.activity)
                return result
            },
        }),
    }
}

function builderTask({ flowName, brief, flowId }: { flowName: string, brief: string, flowId: string | undefined }): string {
    const target = flowId === undefined ? `Build the flow "${flowName}".` : `Change the existing flow "${flowName}" (flowId ${flowId}).`
    return `${target}\n\n${brief}`
}

function builderResult({ flowName, turn, startedAt }: { flowName: string, turn: AgentTurnResult, startedAt: Date }): BuilderResult {
    const finishedEarly = turn.streamError !== null || turn.creditsExhausted || turn.budgetExceeded || turn.truncatedAfterRetries
    const lastMessage = lastText(turn.uiParts)
    const report = lastMessage.length > 0 ? lastMessage : 'The builder stopped without a report. Check the flow with ap_validate_flow before relying on it.'
    return {
        flowName,
        report,
        toolCalls: turn.toolCalls.length,
        finishedEarly,
        activity: {
            flowName,
            status: finishedEarly || lastMessage.length === 0 ? 'failed' : 'done',
            steps: stepsFrom(turn.uiParts),
            pieces: piecesFrom(turn.uiParts),
            startedAt: startedAt.toISOString(),
            durationMs: Date.now() - startedAt.getTime(),
            report,
        },
    }
}

function stepsFrom(parts: PersistedAgentPart[]): SubagentStep[] {
    return parts.flatMap((part): SubagentStep[] => part.type === PersistedAgentPartType.TOOL_CALL
        ? [{ id: part.toolCallId, toolName: part.toolName, status: stepFailed(part.status, part.output) ? 'failed' : 'done', summary: firstLine(part.output) }]
        : [])
}

function piecesFrom(parts: PersistedAgentPart[]): string[] {
    const names = parts.flatMap((part) => part.type === PersistedAgentPartType.TOOL_CALL && PIECE_WRITING_TOOLS.includes(part.toolName) ? pieceNamesIn(part.input) : [])
    return [...new Set(names)]
}

function pieceNamesIn(input: unknown): string[] {
    if (!isObject(input)) {
        return []
    }
    const own = typeof input['pieceName'] === 'string' ? [input['pieceName']] : []
    const trigger = pieceNamesIn(input['trigger'])
    const steps = Array.isArray(input['steps']) ? input['steps'].flatMap(pieceNamesIn) : []
    return [...trigger, ...own, ...steps]
}

function stepFailed(status: PersistedToolCallStatus, output: unknown): boolean {
    return status === PersistedToolCallStatus.ERROR || agentToolClassification.hasFailureTextPrefix(outputText(output).trim())
}

function firstLine(output: unknown): string {
    const text = outputText(output).trim().split('\n')[0] ?? ''
    return text.length > SUMMARY_MAX_LENGTH ? `${text.slice(0, SUMMARY_MAX_LENGTH)}…` : text
}

function outputText(output: unknown): string {
    if (typeof output === 'string') {
        return output
    }
    if (!isObject(output)) {
        return ''
    }
    const content = output['content']
    if (Array.isArray(content)) {
        return content.map((item) => isObject(item) && typeof item['text'] === 'string' ? item['text'] : '').join(' ')
    }
    return typeof output['text'] === 'string' ? output['text'] : ''
}

function lastText(parts: PersistedAgentPart[]): string {
    const texts = parts.flatMap((part) => part.type === PersistedAgentPartType.TEXT && part.text.trim().length > 0 ? [part.text.trim()] : [])
    return texts[texts.length - 1] ?? ''
}

const builderInput = z.object({
    flowName: z.string().min(1).describe('The flow name, in plain words for its one job, e.g. "Save order"'),
    brief: z.string().min(1).describe('Everything the builder needs: folderName, the job, the trigger, the contract (sample data keys it takes or payload keys it sends, the subflow externalId it calls), table and field externalIds, connection externalIds'),
    flowId: z.string().optional().describe('Set to change an existing flow, e.g. to fix an issue ap_validate_flow reported'),
})

const BUILDER_TOOL_NAME = 'ap_build_flow_in_subagent'
const BUILD_TOOL_NAME = 'ap_build_flow'
const SUMMARY_MAX_LENGTH = 120
const PIECE_WRITING_TOOLS = ['ap_build_flow', 'ap_add_step', 'ap_update_step', 'ap_update_trigger']

const BUILDER_TOOL_NAMES = [
    'ap_research_pieces',
    'ap_search_actions',
    'ap_search_triggers',
    'ap_get_piece_props',
    'ap_resolve_property_options',
    'ap_resolve_property_chain',
    'ap_list_connections',
    'ap_list_tables',
    'ap_build_flow',
    'ap_add_step',
    'ap_update_step',
    'ap_update_trigger',
    'ap_delete_step',
    'ap_add_branch',
    'ap_update_branch',
    'ap_delete_branch',
    'ap_flow_structure',
    'ap_read_step_settings',
    'ap_validate_step_config',
    'ap_validate_flow',
]

type BuilderResult = {
    flowName: string
    report: string
    toolCalls: number
    finishedEarly: boolean
    activity: SubagentActivity
}
