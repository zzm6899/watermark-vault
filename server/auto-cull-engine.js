function clamp01(value, fallback = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function boundedScore(value, scale, cap) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(cap, Math.sqrt(value) * scale);
}

function boxCenterScore(box) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = Math.abs(cx - 0.5);
  const dy = Math.abs(cy - 0.43);
  return clamp01(1 - (dx * 1.45 + dy * 1.05));
}

function faceSignalConfidence(file) {
  const boxes = file.faceBoxes || [];
  const faceCount = file.faceCount ?? boxes.length;
  if (faceCount <= 0) return 0;

  const avgDetection = boxes.length > 0
    ? boxes.reduce((sum, box) => sum + clamp01(box.score, file.faceDetection === "estimated" ? 0.45 : 0.78), 0) / boxes.length
    : (file.faceDetection === "estimated" ? 0.38 : 0.58);
  const largestFaceArea = boxes.reduce((best, box) => Math.max(best, box.width * box.height), 0);
  const areaSignal = boxes.length > 0 ? clamp01(largestFaceArea / 0.035) : 0.35;
  const sharpSignal = typeof file.subjectSharpnessScore === "number"
    ? clamp01(file.subjectSharpnessScore / 135)
    : 0.5;
  const nativeSignal = file.faceDetection === "native" ? 0.12 : file.faceDetection === "estimated" ? -0.16 : 0;
  const groupSignal = faceCount >= 2 ? 0.06 : 0;

  return clamp01(
    avgDetection * 0.46 +
    areaSignal * 0.22 +
    sharpSignal * 0.18 +
    0.08 +
    nativeSignal +
    groupSignal,
  );
}

function expressionSignal(box) {
  return clamp01(box.smileScore ?? box.expressionScore, 0.5);
}

function weakestFaceSignal(file) {
  const boxes = file.faceBoxes || [];
  if (boxes.length === 0) return 1;
  return Math.min(...boxes.map((box) => {
    const eye = clamp01((box.eyeScore ?? 0) / 2);
    const detection = clamp01(box.score, 0.8);
    const expression = expressionSignal(box);
    return eye * 0.55 + detection * 0.3 + expression * 0.15;
  }));
}

function faceUsabilityScore(file) {
  const boxes = file.faceBoxes || [];
  const faceCount = file.faceCount ?? boxes.length;
  if (faceCount <= 0) return 0;
  if (boxes.length === 0) return file.faceDetection === "estimated" ? 0.42 : 0.58;

  const usable = boxes.reduce((sum, box) => {
    const eye = clamp01((box.eyeScore ?? 0) / 2);
    const detection = clamp01(box.score, file.faceDetection === "estimated" ? 0.45 : 0.78);
    const expression = expressionSignal(box);
    const size = clamp01((box.width * box.height) / 0.028);
    return sum + eye * 0.45 + detection * 0.3 + expression * 0.12 + size * 0.13;
  }, 0) / boxes.length;
  return clamp01(usable, file.faceDetection === "estimated" ? 0.42 : 0.55);
}

function humanMomentQuality(file) {
  const faceBoxes = file.faceBoxes || [];
  const personBoxes = file.personBoxes || [];
  const faceCount = file.faceCount ?? faceBoxes.length;
  const personCount = file.personCount ?? personBoxes.length;
  const sharp = Math.min(24, (file.subjectSharpnessScore ?? 0) / 6);

  if (faceBoxes.length > 0) {
    const eyeScores = faceBoxes.map((box) => clamp01((box.eyeScore ?? 0) / 2));
    const smileScores = faceBoxes.map((box) => clamp01(box.smileScore ?? box.expressionScore, 0.5));
    const avgEye = eyeScores.reduce((sum, score) => sum + score, 0) / eyeScores.length;
    const minEye = Math.min(...eyeScores);
    const avgSmile = smileScores.reduce((sum, score) => sum + score, 0) / smileScores.length;
    const faceArea = faceBoxes.reduce((sum, box) => sum + box.width * box.height, 0);
    const centered = faceBoxes.reduce((best, box) => Math.max(best, boxCenterScore(box)), 0);
    const groupCoverage = faceCount >= 2 ? Math.min(18, faceCount * 4 + minEye * 14) : 0;

    return Math.round(
      avgEye * 34 +
      minEye * (faceCount >= 2 ? 28 : 14) +
      avgSmile * 12 +
      centered * 12 +
      Math.min(18, faceArea * 90) +
      groupCoverage +
      sharp,
    );
  }

  if (personBoxes.length > 0) {
    const personArea = personBoxes.reduce((sum, box) => sum + box.width * box.height, 0);
    const centered = personBoxes.reduce((best, box) => Math.max(best, boxCenterScore(box)), 0);
    return Math.round(
      Math.min(personCount, 4) * 8 +
      Math.min(24, personArea * 70) +
      centered * 14 +
      sharp,
    );
  }

  return Math.round(sharp);
}

function faceQuality(file) {
  const boxes = file.faceBoxes || [];
  const bestEye = boxes.reduce((best, box) => Math.max(best, box.eyeScore ?? 0), 0);
  const eyeSum = boxes.reduce((sum, box) => sum + (box.eyeScore ?? 0), 0);
  const expression = boxes.reduce((sum, box) => sum + clamp01(box.smileScore ?? box.expressionScore, 0.5), 0);
  const faceCount = file.faceCount ?? boxes.length;
  const faceArea = boxes.reduce((sum, box) => sum + box.width * box.height, 0);
  const largestFaceArea = boxes.reduce((best, box) => Math.max(best, box.width * box.height), 0);
  const sharp = Math.min(60, (file.subjectSharpnessScore ?? 0) / 3);
  const confidence = faceSignalConfidence(file);

  return Math.round(
    (Math.min(faceCount, 4) * 18 +
    bestEye * 18 +
    eyeSum * 7 +
    Math.min(14, expression * 5) +
    Math.min(20, largestFaceArea * 180) +
    Math.min(14, faceArea * 80)) * Math.max(0.35, confidence) +
    sharp,
  );
}

function subjectPresenceQuality(file) {
  const face = faceQuality(file);
  const personBoxes = file.personBoxes || [];
  const personCount = file.personCount ?? personBoxes.length;
  const personArea = personBoxes.reduce((sum, box) => sum + box.width * box.height, 0);
  const personScore = Math.round(
    Math.min(personCount, 3) * 12 +
    Math.min(26, personArea * 90) +
    Math.min(20, (file.subjectSharpnessScore ?? 0) / 5),
  );
  return Math.max(face, personScore);
}

function groupCoverageQuality(file) {
  const faceBoxes = file.faceBoxes || [];
  const personBoxes = file.personBoxes || [];
  const faceCount = file.faceCount ?? faceBoxes.length;
  const personCount = file.personCount ?? personBoxes.length;
  if (faceCount < 2 && personCount < 2) return 0;

  const usableFaces = faceBoxes.filter((box) =>
    clamp01((box.eyeScore ?? 0) / 2) >= 0.5 &&
    clamp01(box.score, file.faceDetection === "estimated" ? 0.45 : 0.78) >= 0.68,
  ).length;
  const usableRatio = faceCount > 0
    ? clamp01(usableFaces / faceCount, faceBoxes.length > 0 ? 0.45 : 0.62)
    : 0;
  const coverageRatio = personCount > 0
    ? clamp01(faceCount / personCount, faceCount > 0 ? 0.55 : 0)
    : clamp01(faceCount / 3);
  const countSignal = Math.min(34, Math.max(faceCount, personCount) * 7 + Math.min(faceCount, personCount) * 3);

  return Math.round(countSignal * (0.36 + coverageRatio * 0.34 + usableRatio * 0.3));
}

function weakFacePenalty(file) {
  const boxes = file.faceBoxes || [];
  const faceCount = file.faceCount ?? boxes.length;
  if (faceCount <= 0) return 0;
  const weakest = weakestFaceSignal(file);
  const usability = faceUsabilityScore(file);
  let penalty = 0;
  if (weakest < 0.24) penalty += faceCount >= 2 ? 72 : 48;
  else if (weakest < 0.42) penalty += faceCount >= 2 ? 42 : 26;
  if (usability < 0.44) penalty += file.faceDetection === "estimated" ? 22 : 12;
  if (file.faceDetection === "estimated" && faceSignalConfidence(file) < 0.5) penalty += 16;
  return penalty;
}

function isDetailStoryKeeper(file) {
  const hasFaces = (file.faceCount ?? file.faceBoxes?.length ?? 0) > 0;
  const hasPeople = (file.personCount ?? file.personBoxes?.length ?? 0) > 0;
  const sharp = Math.max(file.sharpnessScore ?? 0, file.subjectSharpnessScore ?? 0);
  const review = file.reviewScore ?? 0;
  return !hasFaces && !hasPeople && file.type === "photo" && file.blurRisk !== "high" && (sharp >= 120 || review >= 68);
}

function detailStoryQuality(file) {
  const hasFaces = (file.faceCount ?? file.faceBoxes?.length ?? 0) > 0;
  const hasPeople = (file.personCount ?? file.personBoxes?.length ?? 0) > 0;
  if (hasFaces || hasPeople || file.type !== "photo") return 0;
  const sharp = Math.max(file.sharpnessScore ?? 0, file.subjectSharpnessScore ?? 0);
  const review = file.reviewScore ?? 0;
  if (sharp < 70 && review < 50) return 0;
  return Math.round(
    Math.min(42, boundedScore(sharp, 3.2, 34) + Math.min(12, review / 8)) +
    (isDetailStoryKeeper(file) ? 14 : 0),
  );
}

function keeperScore(file) {
  return (
    (file.isProtected ? 120 : 0) +
    (file.rating ?? 0) * 30 +
    subjectPresenceQuality(file) +
    Math.min(70, (file.subjectSharpnessScore ?? 0) / 2.4) +
    Math.min(45, (file.sharpnessScore ?? 0) / 6) +
    Math.min(55, file.reviewScore ?? 0) -
    (file.blurRisk === "high" ? 90 : file.blurRisk === "medium" ? 30 : 0)
  );
}

function bestShotScore(file) {
  const face = faceQuality(file);
  const subject = subjectPresenceQuality(file);
  const subjectSharp = file.subjectSharpnessScore ?? 0;
  const wholeSharp = file.sharpnessScore ?? 0;
  const review = file.reviewScore ?? 0;
  const hasFaces = (file.faceCount ?? file.faceBoxes?.length ?? 0) > 0;
  const hasPeople = (file.personCount ?? file.personBoxes?.length ?? 0) > 0;
  const humanMoment = humanMomentQuality(file);
  const faceReliability = file.faceDetection === "estimated" ? 0.82 : 1;
  const subjectFocus = boundedScore(subjectSharp, hasFaces || hasPeople ? 7.8 : 6.3, 112);
  const wholeFrameFocus = boundedScore(wholeSharp, hasFaces || hasPeople ? 3.7 : 4.7, 62);
  const groupCoverage = groupCoverageQuality(file);
  const detailStory = detailStoryQuality(file);
  const weakFace = weakFacePenalty(file);

  let score =
    (file.isProtected ? 220 : 0) +
    (file.rating ?? 0) * 55 +
    subject * (hasFaces || hasPeople ? 1.08 : 0.45) +
    face * (hasFaces ? 1.18 * faceReliability : 0.18) +
    humanMoment * (hasFaces ? 1.62 : hasPeople ? 1.2 : 0.25) +
    groupCoverage * 1.35 +
    subjectFocus +
    wholeFrameFocus +
    detailStory +
    Math.min(74, review * (hasFaces || hasPeople ? 0.92 : 0.82));

  if (file.pick === "rejected") score -= 140;
  if (typeof file.exposureValue === "number") score += 8;
  if (file.blurRisk === "high") score -= hasFaces ? 150 : 115;
  if (file.blurRisk === "medium") score -= 44;
  score -= weakFace;
  if (hasFaces && subjectSharp > 0 && subjectSharp < 38) score -= 55;
  if (!hasFaces && subjectSharp > 0 && subjectSharp < 28) score -= 25;
  return Math.round(score);
}

function manualPickRank(file) {
  if (file.pick === "rejected") return 0;
  return 1;
}

function isAutoBestCandidate(file) {
  return file.pick !== "rejected";
}

function rankBestShots(files) {
  const keyed = files.map((file) => ({
    file,
    manualPick: manualPickRank(file),
    protected: Number(!!file.isProtected),
    rating: file.rating ?? 0,
    bestShot: bestShotScore(file),
    subjectPresence: subjectPresenceQuality(file),
    face: faceQuality(file),
    subjectSharpness: file.subjectSharpnessScore ?? 0,
    highBlur: Number(file.blurRisk === "high"),
    sharpness: file.sharpnessScore ?? 0,
    review: file.reviewScore ?? 0,
    burstIndex: file.burstIndex ?? 0,
  }));

  keyed.sort((a, b) =>
    b.manualPick - a.manualPick ||
    b.protected - a.protected ||
    b.rating - a.rating ||
    b.bestShot - a.bestShot ||
    b.subjectPresence - a.subjectPresence ||
    b.face - a.face ||
    b.subjectSharpness - a.subjectSharpness ||
    a.highBlur - b.highBlur ||
    b.sharpness - a.sharpness ||
    b.review - a.review ||
    a.burstIndex - b.burstIndex ||
    String(a.file.name || "").localeCompare(String(b.file.name || ""), undefined, { numeric: true }),
  );

  return keyed.map((k) => k.file);
}

function scoreGapConfidence(gap) {
  return gap >= 72 ? "high" : gap >= 28 ? "medium" : "low";
}

function addQuotaKeepers(ranked, keep, options) {
  const candidates = ranked.filter(isAutoBestCandidate);
  const quota = options.keeperQuota || "best-1";
  if (quota === "top-2") {
    for (const file of candidates.slice(0, 2)) keep.add(file.path);
  } else if (quota === "all-rated") {
    for (const file of candidates) {
      if (file.isProtected || (file.rating ?? 0) > 0 || file.pick === "selected") keep.add(file.path);
    }
  } else if (quota === "smile-and-sharp") {
    const expressionScore = (file) => {
      const boxes = file.faceBoxes || [];
      if (boxes.length === 0) return 0;
      return boxes.reduce((best, box) => Math.max(best, clamp01(box.smileScore ?? box.expressionScore, 0.5)), 0);
    };
    const smileBest = candidates.slice().sort((a, b) =>
      expressionScore(b) - expressionScore(a) ||
      humanMomentQuality(b) - humanMomentQuality(a),
    )[0];
    const sharpBest = candidates.slice().sort((a, b) =>
      (b.subjectSharpnessScore ?? b.sharpnessScore ?? 0) - (a.subjectSharpnessScore ?? a.sharpnessScore ?? 0),
    )[0];
    if (smileBest) keep.add(smileBest.path);
    if (sharpBest) keep.add(sharpBest.path);
  }
}

function autoCullGroup(files, options = {}) {
  const ranked = rankBestShots(files);
  const best = ranked.find(isAutoBestCandidate) || null;
  const keep = new Set();
  const reject = new Set();
  const reasons = {};
  if (!best) return { best: null, keep: [], reject: [], confidence: "low", reasons };

  keep.add(best.path);
  addQuotaKeepers(ranked, keep, options);
  for (const filePath of keep) reasons[filePath] = filePath === best.path ? ["best shot"] : ["quota keeper"];
  const bestScore = bestShotScore(best);
  const second = ranked.find((file) => file.path !== best.path && isAutoBestCandidate(file));
  const secondScore = second ? bestShotScore(second) : bestScore;
  const gap = second ? bestScore - secondScore : 0;
  const confidence = options.confidence || "balanced";
  const requiredReasons = confidence === "conservative" ? 4 : confidence === "aggressive" ? 1 : 2;
  const scoreGapThreshold = confidence === "conservative" ? 92 : confidence === "aggressive" ? 48 : 72;
  const blurGapThreshold = confidence === "conservative" ? 58 : confidence === "aggressive" ? 24 : 38;
  const groupMode = options.groupPhotoEveryoneGood;
  const bestFaceCount = best.faceCount ?? best.faceBoxes?.length ?? 0;
  const bestPersonCount = best.personCount ?? best.personBoxes?.length ?? 0;
  const bestWeakestFace = weakestFaceSignal(best);

  for (const file of files) {
    if (file.path === best.path) continue;
    if (file.pick === "rejected") {
      reject.add(file.path);
      reasons[file.path] = ["manual reject"];
      continue;
    }
    if (file.isProtected || (file.rating ?? 0) > 0 || file.pick === "selected") {
      keep.add(file.path);
      reasons[file.path] = ["manual keeper"];
      continue;
    }
    if (confidence !== "aggressive" && isDetailStoryKeeper(file)) {
      keep.add(file.path);
      reasons[file.path] = ["detail/story keeper"];
      continue;
    }
    if (keep.has(file.path)) continue;

    const fileScore = bestShotScore(file);
    const fileReasons = [];
    const bestHumanMoment = humanMomentQuality(best);
    const fileHumanMoment = humanMomentQuality(file);
    const fileFaceCount = file.faceCount ?? file.faceBoxes?.length ?? 0;
    const filePersonCount = file.personCount ?? file.personBoxes?.length ?? 0;
    const weakFace = weakestFaceSignal(file);
    if (file.blurRisk === "high") fileReasons.push("high blur risk");
    if (faceQuality(best) - faceQuality(file) >= 42) fileReasons.push("weaker face/eye detail");
    if (bestHumanMoment - fileHumanMoment >= 28) fileReasons.push("weaker eyes/smile moment");
    if (bestFaceCount >= 2 && bestFaceCount - fileFaceCount >= 1) fileReasons.push("missing group faces");
    if (bestPersonCount >= 2 && bestPersonCount - filePersonCount >= 1) fileReasons.push("fewer people detected");
    if (groupMode && bestFaceCount >= 2 && weakFace < 0.58 && bestWeakestFace - weakFace >= 0.12) fileReasons.push("blink/weak face risk");
    if (groupMode && (bestFaceCount >= 2 || bestPersonCount >= 2) && (fileFaceCount < bestFaceCount || filePersonCount < bestPersonCount)) fileReasons.push("everyone-good miss");
    if ((best.subjectSharpnessScore ?? 0) - (file.subjectSharpnessScore ?? 0) >= 28) fileReasons.push("softer subject");
    if ((best.reviewScore ?? 0) - (file.reviewScore ?? 0) >= 22) fileReasons.push("lower review score");
    if (bestScore - fileScore >= scoreGapThreshold) fileReasons.push("lower best-shot score");
    const enoughReasons = fileReasons.length >= requiredReasons &&
      (confidence !== "conservative" || bestScore - fileScore >= 60);
    if (enoughReasons || (file.blurRisk === "high" && bestScore - fileScore >= blurGapThreshold)) {
      reject.add(file.path);
      reasons[file.path] = fileReasons;
    }
  }

  return {
    best,
    keep: [...keep],
    reject: [...reject],
    confidence: scoreGapConfidence(gap),
    reasons,
  };
}

function scoreReview(input) {
  const sharpness = input.sharpnessScore ?? 0;
  const subjectSharpness = input.subjectSharpnessScore ?? 0;
  const rating = input.rating ?? 0;
  const faceBoxes = input.faceBoxes || [];
  const personBoxes = input.personBoxes || [];
  const faceCount = input.faceCount ?? faceBoxes.length;
  const personCount = input.personCount ?? personBoxes.length;
  let score = Math.min(55, Math.log10(Math.max(1, sharpness) + 1) * 18);
  const reasons = [];

  if (input.isProtected) {
    score += 25;
    reasons.push("protected");
  }
  if (rating > 0) {
    score += rating * 8;
    reasons.push(`${rating} star`);
  }
  if (faceCount > 0) {
    const confidence = faceSignalConfidence(input);
    score += 16 + Math.min(18, faceQuality(input) / 5);
    reasons.push(`${faceCount} face${faceCount === 1 ? "" : "s"}`);
    if (confidence >= 0.78) reasons.push("strong face signal");
    else if (confidence < 0.52) reasons.push("check face confidence");
    const eyeScore = faceBoxes.reduce((best, box) => Math.max(best, box.eyeScore ?? 0), 0);
    if (eyeScore >= 2) reasons.push("eyes sharp");
    else if (eyeScore === 1) reasons.push("face present");
  } else if (personCount > 0) {
    score += 12 + Math.min(14, subjectPresenceQuality(input) / 6);
    reasons.push(`${personCount} person${personCount === 1 ? "" : "s"}`);
  }
  if (subjectSharpness >= 120) {
    score += 22;
    reasons.push("subject sharp");
  } else if (subjectSharpness > 0 && subjectSharpness < 35) {
    score -= 18;
    reasons.push("subject soft");
  }
  if (sharpness >= 180) reasons.push("sharp");
  if (sharpness < 35) reasons.push("soft");
  if (input.visualGroupSize && input.visualGroupSize > 1) reasons.push("similar");
  if (typeof input.exposureValue === "number") score += 5;

  const blurRisk =
    Math.max(sharpness, subjectSharpness) < 25 ? "high"
    : Math.max(sharpness, subjectSharpness) < 70 ? "medium"
    : "low";
  if (blurRisk === "high") score -= 25;
  if (blurRisk === "medium") score -= 8;
  if (blurRisk !== "low" && !reasons.includes("soft")) reasons.push("soft");

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    blurRisk,
    reasons,
  };
}

module.exports = {
  autoCullGroup,
  bestShotScore,
  clamp01,
  humanMomentQuality,
  keeperScore,
  rankBestShots,
  scoreReview,
};
