import { loopSource, stepNames } from '@/metrics/loop';
import type { LoopRun } from '@/metrics/loop';

/** A GET of one route, every page of a list route, and a limit on the requests in flight. */
type Get = <T>(route: string) => Promise<T>;
type List = <T>(route: string, key?: string) => Promise<Array<T>>;
type Limit = <T>(task: () => Promise<T>) => Promise<T>;

/** Reads the runs of the CI workflow and the time of their `validate` step. */
export function loopReader(repo: string, get: Get, list: List, limit: Limit) {
  return {
    /** The runs of the CI workflow created on or after `since`, a date. */
    async loopRuns(since: string): Promise<Array<LoopRun>> {
      const runs = await list<{
        id: number;
        event: string;
        conclusion: string | null;
        created_at: string;
        run_started_at: string;
        updated_at: string;
      }>(
        `repos/${repo}/actions/workflows/${loopSource.workflow}/runs?created=${encodeURIComponent(`>=${since}`)}`,
        'workflow_runs',
      );
      return runs.map((run) => ({
        id: run.id,
        event: run.event,
        conclusion: run.conclusion,
        createdAt: run.created_at,
        runStartedAt: run.run_started_at,
        updatedAt: run.updated_at,
      }));
    },

    /**
     * The seconds of the `validate` step, under any of its `stepNames`, of
     * each run in `ids` whose step passed. A run without that step, or whose step failed, is left out.
     */
    async stepSeconds(ids: Array<number>) {
      const times = await Promise.all(
        ids.map((id) =>
          limit(async () => {
            const { jobs } = await get<{
              jobs: Array<{
                name: string;
                steps?: Array<{
                  name: string;
                  conclusion: string | null;
                  started_at: string | null;
                  completed_at: string | null;
                }>;
              }>;
            }>(`repos/${repo}/actions/runs/${id}/jobs?per_page=100`);
            const step = jobs
              .find((job) => job.name === loopSource.job)
              ?.steps?.find((item) => stepNames.has(item.name));
            if (step?.conclusion !== 'success' || !step.started_at || !step.completed_at) {
              return;
            }
            const time = (Date.parse(step.completed_at) - Date.parse(step.started_at)) / 1000;
            return [id, time] as const;
          }),
        ),
      );
      return new Map(times.filter((entry) => entry !== undefined));
    },
  };
}
