import { AIProviderName, isNil, isObject, tryCatch } from '@activepieces/core-utils'
import { AgentPhase, agentToolClassification, BeginAgentTaskResponse, chatBilling, FinishAgentTaskRequest, PersistedAgentPart, PersistedAgentPartType, PersistedToolCallStatus, SubagentActivity, SubagentStep, TASK_COMPLETION_TOOL_NAME } from '@activepieces/shared'
import { hasToolCall, isLoopFinished, LanguageModel, ModelMessage, tool, ToolSet } from 'ai'
import { z } from 'zod'
import { AgentTurnResult, runAgentTurn, RunAgentTurnParams } from '../run-agent-turn'
import { createPhaseTools } from './session-tools'
import { taskContext } from './task-context'
import { AgentEventEmitter } from './tool-primitives'

export function createTaskSubagentTools({ tools, model, provider, tier, modelId, taskPrompt, creditsLeftFor, beginTask, finishTask, eventEmitter, abortSignal, log }: {
    tools: ToolSet
    model: LanguageModel
    provider: AIProviderName
    tier: RunAgentTurnParams['tier']
    modelId: string
    taskPrompt: string | undefined
    creditsLeftFor: (runKey: string) => RunAgentTurnParams['creditsLeft']
    beginTask: (input: { title: string, taskId?: string }) => Promise<BeginAgentTaskResponse>
    finishTask: (input: Omit<FinishAgentTaskRequest, 'platformId' | 'conversationId'>) => Promise<void>
    eventEmitter: AgentEventEmitter
    abortSignal: AbortSignal
    log: RunAgentTurnParams['log']
}): ToolSet {
    if (isNil(taskPrompt)) {
        return {}
    }
    const workerTools = Object.fromEntries(Object.entries(tools).filter(([name]) => !NOT_FOR_TASKS.includes(name)))
    return {
        [TASK_TOOL_NAME]: tool({
            description: 'Hand one self-contained goal to a focused sub-agent with its own fresh context and the same tools you have (read, search, build, update, execute; risky actions still ask the user for approval). Use it for work whose middle is big or noisy: build and validate one flow, research how to reach an app, work through many records, investigate a failed run. Several calls in one step run in parallel; only parallelize independent goals. It cannot ask the user anything: when it needs something only the user can give it finishes as blocked and says what. Pass taskId to continue a task you started earlier in this conversation (after a block, or for a follow-up on what it built).',
            inputSchema: taskInput,
            execute: async ({ title, brief, taskId }, { toolCallId }) => {
                const { data: begun, error } = await tryCatch(() => beginTask({ title, ...(isNil(taskId) ? {} : { taskId }) }))
                if (error || isNil(begun)) {
                    return { status: 'failed', summary: `Could not start this task: ${error instanceof Error ? error.message : 'unknown error'}` }
                }
                const startedAt = new Date()
                const report = (activity: SubagentActivity) => eventEmitter.emitSubagentProgress({ toolCallId, data: { ...activity, taskId: begun.taskId } })
                report({ title, status: 'running', steps: [], startedAt: startedAt.toISOString() })
                const finish: { result?: TaskResult } = {}
                const priorMessages = begun.messages.filter(isModelMessage)
                const messages: ModelMessage[] = [...priorMessages, { role: 'user', content: brief }]
                const phaseState: { phase: AgentPhase } = { phase: 'discovery' }
                const taskTools = {
                    ...workerTools,
                    ...createPhaseTools({ onPhaseChange: (phase) => {
                        phaseState.phase = phase
                    } }),
                    ...finishTool(finish),
                }
                const turn = await taskContext.run({
                    title,
                    fn: () => runAgentTurn({
                        model,
                        provider,
                        systemPrompt: taskPrompt,
                        messages,
                        tools: taskTools,
                        allToolNames: Object.keys(taskTools),
                        tier,
                        modelId,
                        phaseState,
                        abortSignal,
                        log,
                        creditsLeft: creditsLeftFor(toolCallId),
                        stopWhen: [isLoopFinished(), hasToolCall(TASK_COMPLETION_TOOL_NAME)],
                        sinks: {
                            drainStream: async (result) => {
                                await result.consumeStream()
                            },
                            onProgress: ({ uiParts }) => report(runningActivity({ title, uiParts, startedAt })),
                        },
                    }),
                })
                const result = finish.result ?? fallbackResult(turn)
                const activity = finalActivity({ title, turn, result, startedAt })
                await tryCatch(() => finishTask({
                    taskId: begun.taskId,
                    status: STATUS_BY_RESULT[result.status],
                    messages: [...messages, ...turn.accumulatedResponseMessages],
                    summary: result.summary,
                    artifacts: result.artifacts,
                }))
                report(activity)
                return {
                    taskId: begun.taskId,
                    status: result.status,
                    summary: result.summary,
                    artifacts: result.artifacts,
                    ...(isNil(result.needs) ? {} : { needs: result.needs }),
                    activity,
                    billedToolCalls: billedToolCalls(turn.uiParts),
                }
            },
        }),
    }
}

function finishTool(finish: { result?: TaskResult }): ToolSet {
    return {
        [TASK_COMPLETION_TOOL_NAME]: tool({
            description: 'Call this exactly once, as your last action, to hand your result back. status: done when the goal is achieved, blocked when only the user can unblock you (say what in needs), failed when you tried and could not. summary: a few plain sentences the main assistant can relay. artifacts: everything you created or changed (flows, tables, records, agents) with ids and names.',
            inputSchema: taskResult,
            execute: async (result) => {
                finish.result = result
                return { content: [{ type: 'text', text: 'Result recorded.' }] }
            },
        }),
    }
}

function fallbackResult(turn: AgentTurnResult): TaskResult {
    const lastMessage = lastText(turn.uiParts)
    return {
        status: 'failed',
        summary: lastMessage.length > 0 ? lastMessage : 'The task stopped without reporting a result. Check its work before relying on it.',
        artifacts: [],
    }
}

function runningActivity({ title, uiParts, startedAt }: { title: string, uiParts: PersistedAgentPart[], startedAt: Date }): SubagentActivity {
    const history = statusHistory(uiParts)
    return {
        title,
        status: 'running',
        statusLine: history[history.length - 1],
        statusHistory: history,
        steps: stepsFrom(uiParts),
        pieces: piecesFrom(uiParts),
        startedAt: startedAt.toISOString(),
    }
}

function finalActivity({ title, turn, result, startedAt }: { title: string, turn: AgentTurnResult, result: TaskResult, startedAt: Date }): SubagentActivity {
    const stoppedEarly = turn.streamError !== null || turn.creditsExhausted || turn.budgetExceeded || turn.truncatedAfterRetries
    return {
        ...runningActivity({ title, uiParts: turn.uiParts, startedAt }),
        status: stoppedEarly ? 'failed' : result.status,
        artifacts: result.artifacts,
        summary: result.summary,
        ...(isNil(result.needs) ? {} : { needs: result.needs }),
        durationMs: Date.now() - startedAt.getTime(),
    }
}

function statusHistory(parts: PersistedAgentPart[]): string[] {
    return parts.flatMap((part) => part.type === PersistedAgentPartType.THINKING_STATUS && part.text.trim().length > 0 ? [part.text.trim()] : [])
}

function stepsFrom(parts: PersistedAgentPart[]): SubagentStep[] {
    return parts.flatMap((part): SubagentStep[] => part.type === PersistedAgentPartType.TOOL_CALL
        ? [{ id: part.toolCallId, toolName: part.toolName, status: stepFailed(part.status, part.output) ? 'failed' : 'done', summary: firstLine(part.output) }]
        : [])
}

function billedToolCalls(parts: PersistedAgentPart[]): { toolName: string, output: unknown }[] {
    return parts.flatMap((part) => part.type === PersistedAgentPartType.TOOL_CALL && part.status === PersistedToolCallStatus.COMPLETED && chatBilling.isFlatBilledToolCall({ toolName: part.toolName, output: part.output })
        ? [{ toolName: part.toolName, output: billingOutput(part.output) }]
        : [])
}

function billingOutput(output: unknown): Record<string, unknown> {
    return isObject(output) && output['billedAtCost'] === true ? { billedAtCost: true } : {}
}

function stepFailed(status: PersistedToolCallStatus, output: unknown): boolean {
    return status === PersistedToolCallStatus.ERROR || agentToolClassification.hasFailureTextPrefix(outputText(output).trim())
}

function piecesFrom(parts: PersistedAgentPart[]): string[] {
    const names = parts.flatMap((part) => part.type === PersistedAgentPartType.TOOL_CALL ? pieceNamesIn(part.input) : [])
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

function isModelMessage(value: unknown): value is ModelMessage {
    return isObject(value) && typeof value['role'] === 'string' && 'content' in value
}

const taskInput = z.object({
    title: z.string().min(1).describe('A short plain name for the task the user will see, e.g. "Build Save order" or "Research Twilio WhatsApp"'),
    brief: z.string().min(1).describe('Everything the sub-agent needs, self-contained: the goal and when it is done, what it owns (and must not change), ids and decisions already made, connections to use. For a resumed task, the new instruction or the user\'s answer.'),
    taskId: z.string().optional().describe('Continue a task from earlier in this conversation instead of starting a new one'),
})

const taskResult = z.object({
    status: z.enum(['done', 'blocked', 'failed']),
    summary: z.string().describe('A few plain sentences: what you did and what the main assistant should tell the user'),
    artifacts: z.array(z.object({ type: z.string(), id: z.string(), name: z.string() })).describe('Everything you created or changed'),
    needs: z.string().optional().describe('When blocked: exactly what you need from the user'),
})

const STATUS_BY_RESULT: Record<TaskResult['status'], FinishAgentTaskRequest['status']> = {
    done: 'DONE',
    blocked: 'BLOCKED',
    failed: 'FAILED',
}

const TASK_TOOL_NAME = 'ap_run_task'
const SUMMARY_MAX_LENGTH = 120

const NOT_FOR_TASKS = [
    TASK_TOOL_NAME,
    'ap_show_questions',
    'ap_show_quick_replies',
    'ap_show_connection_picker',
    'ap_show_connection_required',
    'ap_show_project_picker',
    'ap_show_mcp_reconnect',
    'ap_show_showcase',
    'ap_set_build_plan',
    'ap_select_project',
    'ap_deselect_project',
    'ap_remember',
    'ap_generate_image',
]

type TaskResult = z.infer<typeof taskResult>
