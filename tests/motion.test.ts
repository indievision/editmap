import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyKineticVelocity,
  calculateKineticDeltas,
  classifyMomentumTransition,
} from "../src/analysis/motion";
import type { Shot } from "../src/models/project";

test("classifyKineticVelocity properly tiers kinetic energy values", () => {
  assert.equal(classifyKineticVelocity(0), "Still");
  assert.equal(classifyKineticVelocity(12), "Still");
  assert.equal(classifyKineticVelocity(15), "Still");
  assert.equal(classifyKineticVelocity(16), "Gentle Flow");
  assert.equal(classifyKineticVelocity(35), "Gentle Flow");
  assert.equal(classifyKineticVelocity(38), "Gentle Flow");
  assert.equal(classifyKineticVelocity(39), "Dynamic Flow");
  assert.equal(classifyKineticVelocity(65), "Dynamic Flow");
  assert.equal(classifyKineticVelocity(68), "Dynamic Flow");
  assert.equal(classifyKineticVelocity(75), "High Velocity");
  assert.equal(classifyKineticVelocity(100), "High Velocity");
});

test("calculateKineticDeltas calculates energy jump and drop across cuts", () => {
  const shots: Shot[] = [
    {
      id: "s1",
      index: 1,
      startSeconds: 0,
      endSeconds: 3,
      duration: 3,
      motionProfile: {
        cameraMovement: "Static",
        cameraEnergy: 0,
        subjectEnergy: 0,
        totalKineticEnergy: 10,
        confidence: 0.9,
      },
    },
    {
      id: "s2",
      index: 2,
      startSeconds: 3,
      endSeconds: 6,
      duration: 3,
      motionProfile: {
        cameraMovement: "Dynamic / Action",
        cameraEnergy: 50,
        subjectEnergy: 50,
        totalKineticEnergy: 65,
        confidence: 0.9,
      },
    },
    {
      id: "s3",
      index: 3,
      startSeconds: 6,
      endSeconds: 9,
      duration: 3,
      motionProfile: {
        cameraMovement: "Static",
        cameraEnergy: 5,
        subjectEnergy: 5,
        totalKineticEnergy: 15,
        confidence: 0.9,
      },
    },
  ];

  const withDeltas = calculateKineticDeltas(shots);

  // Shot 1 has no preceding shot -> kineticDelta is undefined
  assert.equal(withDeltas[0].motionProfile?.kineticDelta, undefined);

  // Shot 2 jumps from 10 to 65 -> delta +55
  assert.equal(withDeltas[1].motionProfile?.kineticDelta, 55);

  // Shot 3 drops from 65 to 15 -> delta -50
  assert.equal(withDeltas[2].motionProfile?.kineticDelta, -50);
});

test("classifyMomentumTransition classifies cut transitions into intuitive dramatic types", () => {
  assert.deepEqual(classifyMomentumTransition(undefined), {
    label: "Initial Flow Beat",
    type: "initial",
    deltaPercent: 0,
  });

  // Large positive jump -> Accelerando
  const accel = classifyMomentumTransition(35);
  assert.equal(accel.type, "accelerando");
  assert.equal(accel.label, "+35% Accelerando");

  // Large negative drop -> Decrescendo
  const decel = classifyMomentumTransition(-40);
  assert.equal(decel.type, "decrescendo");
  assert.equal(decel.label, "-40% Decrescendo");

  // Moderate change -> Flow Match
  const matchPos = classifyMomentumTransition(12);
  assert.equal(matchPos.type, "match");
  assert.equal(matchPos.label, "+12% Flow Match");

  const matchNeg = classifyMomentumTransition(-8);
  assert.equal(matchNeg.type, "match");
  assert.equal(matchNeg.label, "-8% Flow Match");
});
