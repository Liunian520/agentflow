import { describe, it, expect, beforeEach } from 'vitest';
import { RouterEvolver } from '../routerEvolver';

describe('RouterEvolver', () => {
  let evolver: RouterEvolver;

  beforeEach(() => {
    evolver = new RouterEvolver();
  });

  it('should start with default weights', () => {
    const weights = evolver.getWeights();
    expect(weights.stat).toBeCloseTo(0.50);
    expect(weights.knn).toBeCloseTo(0.35);
    expect(weights.cost).toBeCloseTo(0.15);
  });

  it('should adjust weights when stat predictor is more accurate', () => {
    // 模拟 20 条记录：stat 预测准确率 80%, knn 预测准确率 50%, cost 预测准确率 30%
    for (let i = 0; i < 20; i++) {
      evolver.recordPrediction({
        statCorrect: i < 16,   // 80% 准确
        knnCorrect: i < 10,    // 50% 准确
        costCorrect: i < 6,    // 30% 准确
      });
    }
    evolver.evolve();
    const weights = evolver.getWeights();
    // stat 权重应该增加，cost 权重应该减少
    expect(weights.stat).toBeGreaterThan(0.50);
    expect(weights.cost).toBeLessThan(0.15);
  });

  it('should not evolve with insufficient samples', () => {
    for (let i = 0; i < 5; i++) {
      evolver.recordPrediction({ statCorrect: true, knnCorrect: false, costCorrect: false });
    }
    const oldWeights = evolver.getWeights();
    evolver.evolve();
    const newWeights = evolver.getWeights();
    expect(newWeights).toEqual(oldWeights);
  });

  it('should keep weights normalized (sum to 1.0)', () => {
    for (let i = 0; i < 20; i++) {
      evolver.recordPrediction({ statCorrect: true, knnCorrect: false, costCorrect: false });
    }
    evolver.evolve();
    const weights = evolver.getWeights();
    const sum = weights.stat + weights.knn + weights.cost;
    expect(sum).toBeCloseTo(1.0, 2);
  });

  it('should record evolution history', () => {
    for (let i = 0; i < 20; i++) {
      evolver.recordPrediction({ statCorrect: true, knnCorrect: false, costCorrect: false });
    }
    evolver.evolve();
    const history = evolver.getEvolutionHistory();
    expect(history).toHaveLength(1);
    expect(history[0].oldWeights).toBeDefined();
    expect(history[0].newWeights).toBeDefined();
    expect(history[0].sampleSize).toBe(20);
  });

  it('should respect weight bounds (min 0.05, max 0.80)', () => {
    // 极端情况：stat 全对，其他全错
    for (let i = 0; i < 100; i++) {
      evolver.recordPrediction({ statCorrect: true, knnCorrect: false, costCorrect: false });
    }
    // 多轮进化
    for (let round = 0; round < 10; round++) {
      evolver.evolve();
    }
    const weights = evolver.getWeights();
    expect(weights.stat).toBeLessThanOrEqual(0.80);
    expect(weights.knn).toBeGreaterThanOrEqual(0.05);
    expect(weights.cost).toBeGreaterThanOrEqual(0.05);
  });
});
