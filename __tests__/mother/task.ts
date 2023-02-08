import { Phase, Task, TaskStatus } from '../../src/client/vib/api'

export function cypress(task_id = 'd426abec-4d9e-44d1-b540-0448197d5651', status: TaskStatus = TaskStatus.Succeeded): Task {
  return {
    action_id: 'cypress',
    action_version: '0.113.0',
    status,
    execution_time: 113,
    started_at: '2023-01-19T14:16:08.364005Z',
    phase: Phase.Verify,
    task_id,
    previous_tasks: [],
    next_tasks: [],
    preconditions: [],
    params: {
      'port': '80',
      'host': '192.168.122.123',
      'resources': {
        'path': '/examples/wordpress/cypress',
        'url': 'https://github.com/testproject/'
      },
      'app_protocol': 'HTTP',
      'env': {
        'password': 'test_password',
        'username': 'test_user'
      }
    }
  }
}

export function deployment(task_id = '413e631d-0692-48de-ad4e-3962620b8f40', status: TaskStatus = TaskStatus.Succeeded, 
  next_task?: string): Task {
  return {
    action_id: 'deployment',
    action_version: '0.1.0',
    status,
    execution_time: 123,
    started_at: '2023-01-19T14:16:08.364005Z',
    phase: Phase.Verify,
    task_id,
    previous_tasks: [],
    next_tasks: next_task ? [ next_task ] : [],
    preconditions: [],
    params: {
      'application': {
        'kind': 'HELM',
        'details': {
          'name': 'wordpress',
          'repository': {
            'url': 'oci://docker.io/bitnami/charts'
          },
          'version': '15.0.4'
        }
      }
    }
  }
}

export function helmPackage(task_id = '7447f3d8-f7e8-44b8-a516-3b17ddda24f3', status: TaskStatus = TaskStatus.Succeeded, 
  next_task?: string): Task {
  return {
    action_id: 'helm-package',
    action_version: '0.113.0',
    status,
    execution_time: 19,
    started_at: '2023-01-19T14:16:08.364005Z',
    phase: Phase.Package,
    task_id,
    previous_tasks: [],
    next_tasks: next_task ? [ next_task ] : [],
    preconditions: [],
    params: {
      'resources': {
        'path': '/bitnami/wordpress',
        'url': 'https://github.com/bitnami/charts/tarball/32282c823a92b2520e9ed8599822730c372f01be'
      }
    }
  }

}

export function trivy(task_id = '8b9ea8f0-06d7-4332-b353-afcbadfc89ea', status: TaskStatus = TaskStatus.Succeeded): Task {
  return {
    action_id: 'trivy',
    action_version: '0.113.0',
    status,
    execution_time: 29,
    started_at: '2023-01-19T14:16:08.226643Z',
    phase: Phase.Verify,
    task_id,
    previous_tasks: [],
    next_tasks: [],
    preconditions: [],
    params: {
      'allowlist': [],
      'threshold': 'IGNORE_ALL',
      'application': {
        'kind': 'HELM',
        'details': {
          'name': 'wordpress',
          'repository': {
            'url': 'oci://docker.io/bitnami/charts'
          },
          'version': '15.0.4'
        }
      }
    }
  }
}