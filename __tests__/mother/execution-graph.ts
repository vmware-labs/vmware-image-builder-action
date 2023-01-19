import { ExecutionGraph, Task, TaskStatus } from "../../src/client/vib/api"

export function empty(
  execution_graph_id = '703f96d7-cf0f-4f6a-ba70-d6e9ee322aa1', 
  status: TaskStatus = TaskStatus.Succeeded,
  tasks: Task[] = []): ExecutionGraph {
  return {
    created_at: '2022-11-11T16:23:59.427141Z',
    started_at: '2022-11-11T16:24:00.654397Z',
    execution_time: 1811,
    execution_graph_id,
    status,
    tasks
  }
}
