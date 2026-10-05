import { AIProviderName } from '@activepieces/core-utils'
import { PersistedAgentPartType, PersistedToolCallStatus } from '@activepieces/shared'
import { tool, ToolExecutionOptions, ToolSet } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const runAgentTurn = vi.fn()
const emitSubagentProgress = vi.fn()
vi.mock('../../../../../../src/lib/execute/jobs/ee/agent/run-agent-turn', () => ({
    runAgentTurn: (...args: unknown[]) => runAgentTurn(...args),
}))

import { createBuilderSubagentTools } from '../../../../../../src/lib/execute/jobs/ee/agent/tools/builder-subagent-tools'

describe('createBuilderSubagentTools', () => {
    beforeEach(() => {
        emitSubagentProgress.mockReset()
        runAgentTurn.mockReset()
        runAgentTurn.mockResolvedValue(turnResult({ texts: ['Working on it', 'Built "Save order" (flowId f1, externalId e1). ✅ valid.'] }))
    })

    it('runs the builder in build phase with only flow-building tools and returns its last message as the report', async () => {
        const builder = createBuilderSubagentTools({ ...BASE_PARAMS, tools: toolSet(['ap_build_flow', 'ap_update_step', 'ap_validate_flow', 'ap_lock_and_publish', 'ap_delete_flow', 'ap_test_flow', 'ap_show_quick_replies']) })

        const result = await builder['ap_build_flow_in_subagent'].execute?.({ flowName: 'Save order', brief: 'folderName: Orders' }, EXECUTION_OPTIONS)

        const params = runAgentTurn.mock.calls[0][0]
        expect(Object.keys(params.tools).sort()).toEqual(['ap_build_flow', 'ap_update_step', 'ap_validate_flow'])
        expect(params.phaseState).toEqual({ phase: 'build' })
        expect(params.systemPrompt).toContain('BUILDER PROMPT TEXT')
        expect(params.systemPrompt).toContain('BUILD GUIDE TEXT')
        expect(params.messages).toEqual([{ role: 'user', content: 'Build the flow "Save order".\n\nfolderName: Orders' }])
        expect(result).toMatchObject({ flowName: 'Save order', report: 'Built "Save order" (flowId f1, externalId e1). ✅ valid.', toolCalls: 2, finishedEarly: false })
        const events = emitSubagentProgress.mock.calls.map(([event]) => event)
        expect(events[0]).toMatchObject({ toolCallId: 'call-1', data: { flowName: 'Save order', status: 'running', steps: [] } })
        expect(events[events.length - 1]).toMatchObject({
            toolCallId: 'call-1',
            data: { status: 'done', report: 'Built "Save order" (flowId f1, externalId e1). ✅ valid.', steps: [{ id: 't1', toolName: 'ap_build_flow', status: 'done', summary: '✅ Flow "Save order" created' }, { id: 't2', toolName: 'ap_validate_flow', status: 'failed', summary: '❌ Flow not found.' }] },
        })
    })

    it('points the builder at an existing flow when a flowId is given, and flags a builder that ran out of credits', async () => {
        runAgentTurn.mockResolvedValue({ ...turnResult({ texts: [] }), creditsExhausted: true })
        const builder = createBuilderSubagentTools({ ...BASE_PARAMS, tools: toolSet(['ap_build_flow']) })

        const result = await builder['ap_build_flow_in_subagent'].execute?.({ flowName: 'Save order', brief: 'Fix the payload key', flowId: 'f1' }, EXECUTION_OPTIONS)

        expect(runAgentTurn.mock.calls[0][0].messages[0].content).toContain('Change the existing flow "Save order" (flowId f1).')
        expect(result).toMatchObject({ finishedEarly: true, report: expect.stringContaining('stopped without a report'), activity: { status: 'failed' } })
    })

    it('offers no builder when the flow-building tools or the builder prompt are unavailable', () => {
        expect(createBuilderSubagentTools({ ...BASE_PARAMS, tools: toolSet(['ap_web_search']) })).toEqual({})
        expect(createBuilderSubagentTools({ ...BASE_PARAMS, builderPrompt: undefined, tools: toolSet(['ap_build_flow']) })).toEqual({})
    })
})

function toolSet(names: string[]): ToolSet {
    return Object.fromEntries(names.map((name) => [name, tool({ description: name, inputSchema: z.object({}), execute: async () => 'ok' })]))
}

function turnResult({ texts }: { texts: string[] }): Record<string, unknown> {
    return {
        uiParts: [
            { type: PersistedAgentPartType.TOOL_CALL, toolCallId: 't1', toolName: 'ap_build_flow', input: {}, status: PersistedToolCallStatus.COMPLETED, output: { content: [{ type: 'text', text: '✅ Flow "Save order" created\nOpen: http://x' }] } },
            { type: PersistedAgentPartType.TOOL_CALL, toolCallId: 't2', toolName: 'ap_validate_flow', input: {}, status: PersistedToolCallStatus.ERROR, output: '❌ Flow not found.' },
            ...texts.map((text) => ({ type: PersistedAgentPartType.TEXT, text })),
        ],
        toolCalls: [{ toolName: 'ap_build_flow' }, { toolName: 'ap_validate_flow' }],
        streamError: null,
        creditsExhausted: false,
        budgetExceeded: false,
        truncatedAfterRetries: false,
    }
}

const BASE_PARAMS = {
    model: 'test-model',
    provider: AIProviderName.OPENAI,
    tier: { id: 'smart', thinkingBudget: 0, modelId: 'm' },
    modelId: 'm',
    builderPrompt: 'BUILDER PROMPT TEXT',
    buildGuide: 'BUILD GUIDE TEXT',
    creditsLeft: undefined,
    eventEmitter: { emitToolProgress: vi.fn(), emitActionPreview: vi.fn(), emitActionReceipt: vi.fn(), emitImageGenerated: vi.fn(), emitFileProduced: vi.fn(), emitBuildPlan: vi.fn(), emitSubagentProgress },
    abortSignal: new AbortController().signal,
    log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
}

const EXECUTION_OPTIONS: ToolExecutionOptions = { toolCallId: 'call-1', messages: [] }
