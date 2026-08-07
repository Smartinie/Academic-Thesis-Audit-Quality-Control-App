import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';

const GREETING_TEXT = "Hey Flam...";

export default function Greeting() {
  const [isMounted, setIsMounted] = useState(false);
  const [isFullyRendered, setIsFullyRendered] = useState(false);

  useEffect(() => {
    // Trigger within 100ms of DOMContentLoaded (simulated by mount)
    const timer = setTimeout(() => {
      setIsMounted(true);
    }, 100);
    
    // Calculate when the animation finishes to start the pulse
    // 0.05s stagger * length + base duration
    const totalAnimationTime = 100 + (GREETING_TEXT.length * 50) + 800; // 800ms base duration
    const pulseTimer = setTimeout(() => {
      setIsFullyRendered(true);
    }, totalAnimationTime);

    return () => {
      clearTimeout(timer);
      clearTimeout(pulseTimer);
    };
  }, []);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.05,
      },
    },
  };

  const childVariants = {
    hidden: { 
      opacity: 0, 
      filter: 'blur(10px)',
      y: 10
    },
    visible: { 
      opacity: 1, 
      filter: 'blur(0px)',
      y: 0,
      transition: {
        duration: 0.8,
        ease: [0.22, 1, 0.36, 1] as const, // cubic-bezier(0.22, 1, 0.36, 1)
      }
    },
  };

  return (
    <div 
      className="fixed top-0 left-0 w-full z-50 flex justify-center pointer-events-none"
      style={{ 
        paddingTop: 'max(2vh, 16px)',
        minHeight: '80px', // Pre-defined height to prevent layout shifts
        contain: 'layout' 
      }}
    >
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate={isMounted ? "visible" : "hidden"}
        className={`
          font-sans font-bold text-3xl md:text-4xl 
          text-[#1d1d1f] dark:text-white
          tracking-[-0.02em]
          ${isFullyRendered ? 'animate-pulse-glow' : ''}
        `}
        style={{
          textShadow: isFullyRendered ? '0 0 20px rgba(255, 255, 255, 0.2)' : 'none'
        }}
      >
        {GREETING_TEXT.split('').map((char, index) => (
          <motion.span 
            key={index} 
            variants={childVariants}
            className="inline-block"
            style={{ whiteSpace: char === ' ' ? 'pre' : 'normal' }}
          >
            {char}
          </motion.span>
        ))}
      </motion.div>
    </div>
  );
}
