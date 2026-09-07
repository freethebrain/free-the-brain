/* View state that the template kept as module-level lets: which tab, folds, open cards, capture rows.
   Kept in one mutable object so the render and event modules share it without a framework. */
import type { TabId } from "./constants";

export interface ViewState {
  tab: TabId;
  hideSubs: boolean;
  hideJudged: boolean;
  chunkIdx: number;
  expand: Record<string, boolean>;
  branchClosed: Record<string, boolean>;
  cardOpen: Record<string, boolean>;
  /** capture row values, indexed over RESERVED.concat(extra) */
  capVals: string[];
  /** extra capture IDs added past the reserved block */
  extra: string[];
}

export const view: ViewState = {
  tab: "portfolio",
  hideSubs: false,
  hideJudged: false,
  chunkIdx: 0,
  expand: {},
  branchClosed: {},
  cardOpen: {},
  capVals: [],
  extra: [],
};
