import * as core from "@actions/core"
import Action from "./action"

async function run(): Promise<void> {
  try {
    const action = new Action(process.env.GITHUB_WORKSPACE || __dirname)
    await action.main()
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    }
  }
}

run()