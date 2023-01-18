import Action from "./action"

async function run(): Promise<void> {
  const action = new Action(process.env.GITHUB_WORKSPACE || __dirname)
  await action.main()
}

run()