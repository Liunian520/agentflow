import type { RouterEvolutionRecord } from '../types';

const MIN_SAMPLES_TO_EVOLVE = 15;
const LEARNING_RATE = 0.05;
const MIN_WEIGHT = 0.05;
const MAX_WEIGHT = 0.80;

interface PredictionRecord {
  statCorrect: boolean;
  knnCorrect: boolean;
  costCorrect: boolean;
}

/**
 * Router Auto-Evolver — 路由策略自进化器
 *
 * 职责：
 * - 跟踪三个预测器（stat/knn/cost）的准确率
 * - 当样本足够时，按准确率比例调整融合权重
 * - 记录进化历史，支持回溯
 *
 * 核心公式：
 *   new_weight_i = old_weight_i + lr * (accuracy_i - avg_accuracy)
 *   然后归一化并 clamp 到 [MIN_WEIGHT, MAX_WEIGHT]
 */
export class RouterEvolver {
  private weights = { stat: 0.50, knn: 0.35, cost: 0.15 };
  private predictions: PredictionRecord[] = [];
  private history: RouterEvolutionRecord[] = [];
  private maxPredictionBuffer = 100;

  getWeights(): { stat: number; knn: number; cost: number } {
    return { ...this.weights };
  }

  setWeights(weights: { stat: number; knn: number; cost: number }): void {
    this.weights = { ...weights };
  }

  /** 记录一次路由预测的结果（三个预测器各自是否预测正确） */
  recordPrediction(record: PredictionRecord): void {
    this.predictions.push(record);
    if (this.predictions.length > this.maxPredictionBuffer) {
      this.predictions.shift();
    }
  }

  /** 执行一轮进化：根据预测准确率调整权重 */
  evolve(): RouterEvolutionRecord | null {
    if (this.predictions.length < MIN_SAMPLES_TO_EVOLVE) {
      return null;
    }

    const samples = this.predictions.length;
    const statAcc = this.predictions.filter((p) => p.statCorrect).length / samples;
    const knnAcc = this.predictions.filter((p) => p.knnCorrect).length / samples;
    const costAcc = this.predictions.filter((p) => p.costCorrect).length / samples;
    const avgAcc = (statAcc + knnAcc + costAcc) / 3;

    const oldWeights = { ...this.weights };

    // 按准确率偏差调整权重
    let newStat = this.weights.stat + LEARNING_RATE * (statAcc - avgAcc);
    let newKnn = this.weights.knn + LEARNING_RATE * (knnAcc - avgAcc);
    let newCost = this.weights.cost + LEARNING_RATE * (costAcc - avgAcc);

    // 归一化
    const sum = newStat + newKnn + newCost;
    newStat /= sum;
    newKnn /= sum;
    newCost /= sum;

    // Clamp
    this.weights = {
      stat: Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, newStat)),
      knn: Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, newKnn)),
      cost: Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, newCost)),
    };

    // 最终再归一化一次（clamp 后可能不再和为 1）
    const finalSum = this.weights.stat + this.weights.knn + this.weights.cost;
    this.weights.stat /= finalSum;
    this.weights.knn /= finalSum;
    this.weights.cost /= finalSum;

    const record: RouterEvolutionRecord = {
      timestamp: Date.now(),
      oldWeights,
      newWeights: { ...this.weights },
      accuracyBefore: avgAcc,
      accuracyAfter: avgAcc, // 进化后的准确率需要后续样本验证
      sampleSize: samples,
      trigger: 'scheduled',
    };

    this.history.push(record);
    if (this.history.length > 50) {
      this.history.shift();
    }

    // 清空预测缓冲，开始新一轮观测
    this.predictions = [];

    return record;
  }

  getEvolutionHistory(): RouterEvolutionRecord[] {
    return [...this.history];
  }

  /** 评估当前权重下的预测准确率 */
  getAccuracy(): { stat: number; knn: number; cost: number } | null {
    if (this.predictions.length === 0) return null;
    const n = this.predictions.length;
    return {
      stat: this.predictions.filter((p) => p.statCorrect).length / n,
      knn: this.predictions.filter((p) => p.knnCorrect).length / n,
      cost: this.predictions.filter((p) => p.costCorrect).length / n,
    };
  }
}

/** 全局单例 */
let globalEvolver: RouterEvolver | null = null;

export function getRouterEvolver(): RouterEvolver {
  if (!globalEvolver) {
    globalEvolver = new RouterEvolver();
  }
  return globalEvolver;
}
