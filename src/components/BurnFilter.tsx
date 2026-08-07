import React from 'react';

export const BurnFilter = () => {
  return (
    <svg width="0" height="0" className="absolute pointer-events-none">
      <filter id="paper-burn" x="-20%" y="-20%" width="140%" height="140%">
        {/* Generate noise */}
        <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="4" result="noise" />
        
        {/* Extract noise to alpha channel */}
        <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" in="noise" result="noiseAlpha" />
        
        {/* Invert noise alpha: 1 - noiseAlpha */}
        <feComponentTransfer in="noiseAlpha" result="invNoiseAlpha">
          <feFuncA type="linear" slope="-1" intercept="1" />
        </feComponentTransfer>
        
        {/* Expand SourceGraphic alpha from [0, 1] to [-0.5, 1.5] */}
        <feComponentTransfer in="SourceGraphic" result="expandedAlpha">
          <feFuncA type="linear" slope="2" intercept="-0.5" />
        </feComponentTransfer>
        
        {/* Add expandedAlpha and invNoiseAlpha */}
        <feComposite operator="arithmetic" k2="1" k3="1" in="expandedAlpha" in2="invNoiseAlpha" result="addedAlpha" />
        
        {/* Threshold the result at 1.0 */}
        <feComponentTransfer in="addedAlpha" result="thresholdedAlpha">
          <feFuncA type="linear" slope="100" intercept="-100" />
        </feComponentTransfer>
        
        {/* Apply the thresholded alpha to the original RGB of the SourceGraphic */}
        <feComposite operator="in" in="SourceGraphic" in2="thresholdedAlpha" result="final" />
        
        {/* Add a slight displacement to make it look like melting/burning */}
        <feDisplacementMap in="final" in2="noise" scale="4" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
};

