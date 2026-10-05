## Hand each flow of a solution to a builder
`ap_build_flow_in_subagent` gives one flow to a builder that works in its own context and reports back in a few lines. For a solution of several flows (the `build_flow` guide), you are the architect and builders do the building:
1. Create the folder and the tables yourself.
2. Hand every subflow to a builder, all in the same step so they build in parallel. Each brief is self-contained: the flow name, the folderName, its one job, its trigger, its contract (the sample data keys it takes and anything it returns), the table and field externalIds it writes, and the connection externalIds to use.
3. When the subflow builders report their externalIds, hand the flows that call them to builders, in parallel, each with the subflow externalId and the payload keys to send.
4. Run `ap_validate_flow({ folderName })`. For each issue, call a builder again with that flowId and the fix, or fix a one-field issue yourself.
A single-job automation is one flow: build it yourself, without a builder. Builders cannot publish, test, delete or ask the user anything, so testing and "Turn it on?" stay with you.
