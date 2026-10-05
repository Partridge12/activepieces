import { AIProviderName, isNil } from '@activepieces/core-utils'
import { PersistedAgentPart, PersistedAgentPartType } from '@activepieces/shared'
import { LanguageModel, tool, ToolSet } from 'ai'
import { z } from 'zod'
import { AgentTurnResult, runAgentTurn, RunAgentTurnParams } from '../run-agent-turn'

export function createBuilderSubagentTools({ tools, model, provider, tier, modelId, builderPrompt, buildGuide, creditsLeft, abortSignal, log }: {
    tools: ToolSet
    model: LanguageModel
    provider: AIProviderName
    tier: RunAgentTurnParams['tier']
    modelId: string
    builderPrompt: string | undefined
    buildGuide: string
    creditsLeft: RunAgentTurnParams['creditsLeft']
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
            execute: async ({ flowName, brief, flowId }) => {
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
                })
                return builderReport({ flowName, turn })
            },
        }),
    }
}

function builderTask({ flowName, brief, flowId }: { flowName: string, brief: string, flowId: string | undefined }): string {
    const target = flowId === undefined ? `Build the flow "${flowName}".` : `Change the existing flow "${flowName}" (flowId ${flowId}).`
    return `${target}\n\n${brief}`
}

function builderReport({ flowName, turn }: { flowName: string, turn: AgentTurnResult }): { flowName: string, report: string, toolCalls: number, finishedEarly: boolean } {
    const finishedEarly = turn.streamError !== null || turn.creditsExhausted || turn.budgetExceeded || turn.truncatedAfterRetries
    const report = lastText(turn.uiParts)
    return {
        flowName,
        report: report.length > 0 ? report : 'The builder stopped without a report. Check the flow with ap_validate_flow before relying on it.',
        toolCalls: turn.toolCalls.length,
        finishedEarly,
    }
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

