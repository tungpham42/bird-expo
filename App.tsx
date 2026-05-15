import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  StyleSheet,
  View,
  Text,
  Dimensions,
  Pressable,
  Animated,
  Easing,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Rect, Ellipse, Path, G, Line } from "react-native-svg";
import { useAudioPlayer, setAudioModeAsync } from "expo-audio";
import mobileAds, {
  TestIds,
  useInterstitialAd,
} from "react-native-google-mobile-ads";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

// --- Global Constants ---
const PIPE_WIDTH = 75;
const BIRD_SIZE = 44;
const BIRD_X_POSITION = 60;
const GROUND_HEIGHT = 80;

type Level = "Easy" | "Medium" | "Hard";

interface LevelConfig {
  gravity: number;
  jumpVelocity: number;
  pipeSpeed: number;
  pipeSpawnRate: number;
  pipeGap: number;
}

const LEVEL_CONFIGS: Record<Level, LevelConfig> = {
  Easy: {
    gravity: 0.25,
    jumpVelocity: 5.5,
    pipeSpeed: 2.5,
    pipeSpawnRate: 2000,
    pipeGap: 240,
  },
  Medium: {
    gravity: 0.35,
    jumpVelocity: 6.5,
    pipeSpeed: 3.5,
    pipeSpawnRate: 1600,
    pipeGap: 180,
  },
  Hard: {
    gravity: 0.45,
    jumpVelocity: 7.5,
    pipeSpeed: 4.5,
    pipeSpawnRate: 1200,
    pipeGap: 140,
  },
};

// Use Test ID for development, use your real Ad Unit ID for production
const interstitialAdUnitId = __DEV__
  ? TestIds.INTERSTITIAL
  : "ca-app-pub-3585118770961536/3796701393";

type GameState = "MENU" | "PLAYING" | "GAME_OVER";

interface PipeData {
  x: number;
  topHeight: number;
  passed: boolean;
}

// --- Sound Sources ---
// Preload files for the useAudioPlayer hooks
const jumpAudioSource = require("./assets/sounds/jump.wav");
const scoreAudioSource = require("./assets/sounds/score.wav");
const crashAudioSource = require("./assets/sounds/crash.wav");

// --- Cloud Component for Animations ---
const AnimatedCloud = ({
  top,
  duration,
  delay,
  flip,
}: {
  top: string;
  duration: number;
  delay: number;
  flip?: boolean;
}) => {
  const moveAnim = useRef(new Animated.Value(SCREEN_WIDTH)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(moveAnim, {
        toValue: -150,
        duration: duration,
        delay: delay,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [duration, delay, moveAnim]);

  return (
    <Animated.View
      style={{
        position: "absolute",
        top: top as any,
        left: 0,
        width: 100,
        height: 60,
        transform: [{ translateX: moveAnim }, { scaleX: flip ? -1 : 1 }],
      }}
    >
      <Svg viewBox="0 0 100 60" width="100%" height="100%">
        <G opacity="0.5" fill="#fff">
          <Circle cx="25" cy="40" r="15" />
          <Circle cx="45" cy="30" r="25" />
          <Circle cx="75" cy="35" r="20" />
          <Rect x="25" y="30" width="50" height="25" />
        </G>
      </Svg>
    </Animated.View>
  );
};

export default function App() {
  const [gameState, setGameState] = useState<GameState>("MENU");
  const [level, setLevel] = useState<Level>("Medium");
  const [birdPos, setBirdPos] = useState<number>(SCREEN_HEIGHT / 2);
  const [pipes, setPipes] = useState<PipeData[]>([]);
  const [score, setScore] = useState<number>(0);

  // --- NEW: Track Deaths ---
  const [deathCount, setDeathCount] = useState<number>(0);

  // --- NEW: AdMob Interstitial Hook ---
  const { isLoaded, isClosed, load, show } = useInterstitialAd(
    interstitialAdUnitId,
    {
      requestNonPersonalizedAdsOnly: true,
    },
  );

  // Load the ad as soon as the app starts, and reload it whenever an ad is closed
  useEffect(() => {
    load();
  }, [load, isClosed]);

  const velocityRef = useRef(0);
  const currentConfig = LEVEL_CONFIGS[level];

  // --- Audio Players (Using expo-audio) ---
  const jumpPlayer = useAudioPlayer(jumpAudioSource);
  const scorePlayer = useAudioPlayer(scoreAudioSource);
  const crashPlayer = useAudioPlayer(crashAudioSource);

  useEffect(() => {
    // Configure audio to play even if the physical switch is on silent (iOS)
    setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: "duckOthers",
    }).catch((err) => console.warn("Could not set audio mode:", err));
  }, []);

  // --- Audio Playback Functions ---
  const playJumpSound = useCallback(() => {
    if (jumpPlayer) {
      jumpPlayer.seekTo(0);
      jumpPlayer.play();
    }
  }, [jumpPlayer]);

  const playScoreSound = useCallback(() => {
    if (scorePlayer) {
      scorePlayer.seekTo(0);
      scorePlayer.play();
    }
  }, [scorePlayer]);

  const playCrashSound = useCallback(() => {
    if (crashPlayer) {
      crashPlayer.seekTo(0);
      crashPlayer.play();
    }
  }, [crashPlayer]);

  // --- Game Loop (Physics & Movement) ---
  useEffect(() => {
    let reqId: number;

    const updateLoop = () => {
      if (gameState !== "PLAYING") return;

      velocityRef.current += currentConfig.gravity;
      setBirdPos((prev) => prev + velocityRef.current);

      setPipes((prevPipes) => {
        return prevPipes
          .map((pipe) => ({ ...pipe, x: pipe.x - currentConfig.pipeSpeed }))
          .filter((pipe) => pipe.x + PIPE_WIDTH > -20);
      });

      reqId = requestAnimationFrame(updateLoop);
    };

    if (gameState === "PLAYING") {
      reqId = requestAnimationFrame(updateLoop);
    }

    return () => cancelAnimationFrame(reqId);
  }, [gameState, currentConfig]);

  // --- Pipe Spawner ---
  useEffect(() => {
    let pipeId: number;

    if (gameState === "PLAYING") {
      pipeId = setInterval(() => {
        const minPipeHeight = 60;
        const maxPipeHeight =
          SCREEN_HEIGHT - GROUND_HEIGHT - currentConfig.pipeGap - minPipeHeight;

        const safeMaxHeight = Math.max(minPipeHeight, maxPipeHeight);
        const randomHeight =
          Math.floor(Math.random() * (safeMaxHeight - minPipeHeight + 1)) +
          minPipeHeight;

        setPipes((prev) => [
          ...prev,
          { x: SCREEN_WIDTH + 50, topHeight: randomHeight, passed: false },
        ]);
      }, currentConfig.pipeSpawnRate) as unknown as number;
    }

    return () => clearInterval(pipeId);
  }, [gameState, currentConfig]);

  // --- Game Over Logic & Ads ---
  const handleGameOver = useCallback(() => {
    setGameState("GAME_OVER");

    setDeathCount((prevCount) => {
      const newCount = prevCount + 1;
      // Trigger the ad every 3 deaths
      if (newCount % 3 === 0 && isLoaded) {
        show();
      }
      return newCount;
    });
  }, [isLoaded, show]);

  // --- Collision Detection & Scoring ---
  useEffect(() => {
    if (gameState !== "PLAYING") return;

    const HITBOX_PADDING_X = 10;
    const HITBOX_PADDING_Y = 12;

    const birdLeft = BIRD_X_POSITION + HITBOX_PADDING_X;
    const birdRight = BIRD_X_POSITION + BIRD_SIZE - HITBOX_PADDING_X;
    const birdTop = birdPos + HITBOX_PADDING_Y;
    const birdBottom = birdPos + BIRD_SIZE - HITBOX_PADDING_Y;

    const hasCollidedWithFloor = birdBottom >= SCREEN_HEIGHT - GROUND_HEIGHT;
    const hasCollidedWithCeiling = birdTop <= 0;

    if (hasCollidedWithFloor || hasCollidedWithCeiling) {
      playCrashSound();
      handleGameOver(); // <-- Replaced setGameState("GAME_OVER")
      return;
    }

    pipes.forEach((pipe, index) => {
      const inPipeHorizontalRange =
        birdRight >= pipe.x && birdLeft <= pipe.x + PIPE_WIDTH;

      const hitTopPipe = birdTop <= pipe.topHeight;
      const hitBottomPipe =
        birdBottom >= pipe.topHeight + currentConfig.pipeGap;

      if (inPipeHorizontalRange && (hitTopPipe || hitBottomPipe)) {
        playCrashSound();
        handleGameOver(); // <-- Replaced setGameState("GAME_OVER")
      }

      if (!pipe.passed && pipe.x + PIPE_WIDTH < birdLeft) {
        playScoreSound();
        setScore((prev) => prev + 1);
        setPipes((prev) => {
          const newPipes = [...prev];
          newPipes[index].passed = true;
          return newPipes;
        });
      }
    });
  }, [
    birdPos,
    pipes,
    gameState,
    currentConfig,
    playCrashSound,
    playScoreSound,
    handleGameOver,
  ]);

  // --- Controls ---
  const handleJump = useCallback(() => {
    if (gameState === "PLAYING") {
      playJumpSound();
      velocityRef.current = -currentConfig.jumpVelocity;
    }
  }, [gameState, currentConfig, playJumpSound]);

  const startGame = (selectedLevel: Level) => {
    setLevel(selectedLevel);
    setBirdPos(SCREEN_HEIGHT / 2);
    velocityRef.current = 0;
    setPipes([]);
    setScore(0);
    setGameState("PLAYING");
  };

  const returnToMenu = () => {
    setGameState("MENU");
    setBirdPos(SCREEN_HEIGHT / 2);
    velocityRef.current = 0;
    setPipes([]);
    setScore(0);
  };

  const birdRotation =
    gameState === "PLAYING"
      ? Math.min(Math.max(velocityRef.current * 4, -25), 90)
      : 0;

  return (
    <View style={styles.wrapper}>
      <Pressable style={styles.container} onPressIn={handleJump}>
        <LinearGradient
          colors={["#ffdca8", "#ffac81"]}
          style={StyleSheet.absoluteFillObject}
        />

        {/* Clouds */}
        <AnimatedCloud top="12%" duration={35000} delay={0} />
        <AnimatedCloud top="28%" duration={48000} delay={5000} flip />
        <AnimatedCloud top="8%" duration={60000} delay={10000} />
        <AnimatedCloud top="40%" duration={42000} delay={2000} flip />

        {/* Play State UI */}
        {gameState === "PLAYING" && (
          <Text style={styles.scoreDisplay}>{score}</Text>
        )}

        {/* The Bird */}
        <View
          style={[
            styles.birdContainer,
            {
              top: birdPos,
              transform: [{ rotate: `${birdRotation}deg` }],
            },
          ]}
        >
          <Svg
            width="100%"
            height="100%"
            viewBox="0 0 100 100"
            style={{ overflow: "visible" }}
          >
            <Ellipse
              cx="50"
              cy="56"
              rx="40"
              ry="32"
              fill="rgba(92, 64, 51, 0.2)"
            />
            <Ellipse
              cx="50"
              cy="50"
              rx="40"
              ry="32"
              fill="#ffd166"
              stroke="#5c4033"
              strokeWidth="6"
            />
            <Path
              d="M 15 50 Q 30 30 50 55 Z"
              fill="#fff5eb"
              stroke="#5c4033"
              strokeWidth="5"
              strokeLinejoin="round"
            />
            <Circle
              cx="70"
              cy="38"
              r="12"
              fill="white"
              stroke="#5c4033"
              strokeWidth="5"
            />
            <Circle cx="74" cy="38" r="5" fill="#5c4033" />
            <Path
              d="M 80 46 Q 98 52 78 60 Z"
              fill="#ef476f"
              stroke="#5c4033"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </View>

        {/* Pipes */}
        {pipes.map((pipe, i) => {
          const bottomPipeHeight =
            SCREEN_HEIGHT -
            pipe.topHeight -
            currentConfig.pipeGap -
            GROUND_HEIGHT;
          return (
            <React.Fragment key={i}>
              <View
                style={{
                  position: "absolute",
                  top: 0,
                  left: pipe.x,
                  width: PIPE_WIDTH,
                  height: pipe.topHeight,
                  zIndex: 5,
                }}
              >
                <Svg width="100%" height="100%" preserveAspectRatio="none">
                  <Rect
                    x="6"
                    y="-10"
                    width={PIPE_WIDTH - 12}
                    height={pipe.topHeight + 10}
                    fill="#a2d149"
                    stroke="#5c4033"
                    strokeWidth="6"
                  />
                  <Rect
                    x="0"
                    y={pipe.topHeight - 30}
                    width={PIPE_WIDTH}
                    height="30"
                    rx="10"
                    fill="#a2d149"
                    stroke="#5c4033"
                    strokeWidth="6"
                  />
                  <Rect
                    x="14"
                    y="-10"
                    width="8"
                    height={pipe.topHeight - 20}
                    fill="#c4f07a"
                    opacity="0.6"
                  />
                </Svg>
              </View>

              <View
                style={{
                  position: "absolute",
                  top: pipe.topHeight + currentConfig.pipeGap,
                  left: pipe.x,
                  width: PIPE_WIDTH,
                  height: bottomPipeHeight,
                  zIndex: 5,
                }}
              >
                <Svg width="100%" height="100%" preserveAspectRatio="none">
                  <Rect
                    x="6"
                    y="20"
                    width={PIPE_WIDTH - 12}
                    height={bottomPipeHeight}
                    fill="#a2d149"
                    stroke="#5c4033"
                    strokeWidth="6"
                  />
                  <Rect
                    x="0"
                    y="0"
                    width={PIPE_WIDTH}
                    height="30"
                    rx="10"
                    fill="#a2d149"
                    stroke="#5c4033"
                    strokeWidth="6"
                  />
                  <Rect
                    x="14"
                    y="30"
                    width="8"
                    height={bottomPipeHeight}
                    fill="#c4f07a"
                    opacity="0.6"
                  />
                </Svg>
              </View>
            </React.Fragment>
          );
        })}

        {/* Ground */}
        <View style={styles.groundContainer}>
          <Svg width="100%" height="100%" preserveAspectRatio="none">
            <Rect
              x="0"
              y="0"
              width="100%"
              height="100%"
              fill="#e09f5a"
              stroke="#5c4033"
              strokeWidth="8"
            />
            <Rect
              x="0"
              y="0"
              width="100%"
              height="16"
              fill="#f4c878"
              stroke="#5c4033"
              strokeWidth="6"
            />
            <Line
              x1="10%"
              y1="40"
              x2="20%"
              y2="40"
              stroke="#c87a38"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <Line
              x1="45%"
              y1="55"
              x2="52%"
              y2="55"
              stroke="#c87a38"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <Line
              x1="75%"
              y1="35"
              x2="88%"
              y2="35"
              stroke="#c87a38"
              strokeWidth="4"
              strokeLinecap="round"
            />
          </Svg>
        </View>

        {/* Overlays */}
        {gameState === "MENU" && (
          <View style={styles.overlayPanel}>
            <Text style={styles.overlayTitle}>Softy Bird</Text>
            <Text style={styles.overlaySubtitle}>Choose your level</Text>
            {(Object.keys(LEVEL_CONFIGS) as Level[]).map((lvl) => (
              <Pressable
                key={lvl}
                onPress={() => startGame(lvl)}
                style={
                  [
                    styles.btnFriendly,
                    styles[`btn${lvl}` as keyof typeof styles],
                  ] as any
                }
              >
                <Text style={styles.btnText}>{lvl} Mode</Text>
              </Pressable>
            ))}
          </View>
        )}

        {gameState === "GAME_OVER" && (
          <View style={styles.overlayPanel}>
            <Text style={styles.overlayTitle}>Oops!</Text>
            <Text style={styles.overlaySubtitle}>
              You scored {score} points
            </Text>
            <Pressable
              onPress={() => startGame(level)}
              style={[styles.btnFriendly, styles.btnAction]}
            >
              <Text style={styles.btnText}>Try Again</Text>
            </Pressable>
            <Pressable
              onPress={returnToMenu}
              style={[styles.btnFriendly, styles.btnMenu]}
            >
              <Text style={styles.btnText}>Main Menu</Text>
            </Pressable>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    backgroundColor: "#fce8d5",
  },
  container: {
    flex: 1,
    overflow: "hidden",
  },
  birdContainer: {
    position: "absolute",
    left: BIRD_X_POSITION,
    width: BIRD_SIZE,
    height: BIRD_SIZE,
    zIndex: 10,
  },
  groundContainer: {
    position: "absolute",
    bottom: 0,
    width: "100%",
    height: GROUND_HEIGHT,
    zIndex: 15,
  },
  scoreDisplay: {
    position: "absolute",
    top: 60,
    width: "100%",
    textAlign: "center",
    fontSize: 72,
    fontWeight: "800",
    color: "#fff",
    zIndex: 10,
    textShadowColor: "rgba(92, 64, 51, 0.5)",
    textShadowOffset: { width: 4, height: 6 },
    textShadowRadius: 1,
  },
  overlayPanel: {
    position: "absolute",
    top: "30%",
    alignSelf: "center",
    backgroundColor: "rgba(255, 250, 245, 0.95)",
    padding: 30,
    borderRadius: 32,
    borderWidth: 4,
    borderColor: "#5c4033",
    width: "80%",
    alignItems: "center",
    zIndex: 20,
    elevation: 5,
    shadowColor: "#5c4033",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 0,
  },
  overlayTitle: {
    fontSize: 38,
    fontWeight: "800",
    color: "#5c4033",
    marginBottom: 10,
  },
  overlaySubtitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#8c6b5d",
    marginBottom: 25,
  },
  btnFriendly: {
    borderWidth: 3,
    borderColor: "#5c4033",
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 99,
    width: "100%",
    alignItems: "center",
    marginBottom: 12,
  },
  btnText: {
    fontSize: 18,
    fontWeight: "800",
    color: "#fff",
  },
  btnEasy: { backgroundColor: "#a2d149" },
  btnMedium: { backgroundColor: "#ffb142" },
  btnHard: { backgroundColor: "#ff6b6b" },
  btnAction: { backgroundColor: "#45aaf2" },
  btnMenu: { backgroundColor: "#a4b0be" },
});
