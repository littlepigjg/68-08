const StyleTransfer = {
    analyzeImage(imageElement) {
        return new Promise((resolve, reject) => {
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                const maxSize = 800;
                let width = imageElement.naturalWidth || imageElement.width;
                let height = imageElement.naturalHeight || imageElement.height;
                
                if (width > maxSize || height > maxSize) {
                    const ratio = Math.min(maxSize / width, maxSize / height);
                    width = Math.floor(width * ratio);
                    height = Math.floor(height * ratio);
                }
                
                canvas.width = width;
                canvas.height = height;
                
                ctx.drawImage(imageElement, 0, 0, width, height);
                
                const imageData = ctx.getImageData(0, 0, width, height);
                const features = this.extractFeatures(imageData, width, height);
                
                resolve(features);
            } catch (error) {
                reject(error);
            }
        });
    },

    extractFeatures(imageData, width, height) {
        const data = imageData.data;
        const grayscale = this.toGrayscale(data, width, height);
        
        const binary = this.thresholdImage(grayscale, width, height);
        
        const inkFeatures = this.analyzeInkDistribution(binary, grayscale, width, height);
        
        const strokeFeatures = this.analyzeStrokeFeatures(binary, width, height);
        
        const slantFeatures = this.analyzeSlant(binary, width, height);
        
        const textureFeatures = this.analyzeTexture(grayscale, binary, width, height);
        
        return {
            ...inkFeatures,
            ...strokeFeatures,
            ...slantFeatures,
            ...textureFeatures,
            width,
            height
        };
    },

    toGrayscale(data, width, height) {
        const gray = new Float32Array(width * height);
        for (let i = 0; i < width * height; i++) {
            const idx = i * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
        }
        return gray;
    },

    thresholdImage(grayscale, width, height) {
        const threshold = this.otsuThreshold(grayscale);
        const binary = new Uint8Array(width * height);
        for (let i = 0; i < width * height; i++) {
            binary[i] = grayscale[i] < threshold ? 1 : 0;
        }
        return binary;
    },

    otsuThreshold(grayscale) {
        const histogram = new Array(256).fill(0);
        for (let i = 0; i < grayscale.length; i++) {
            const val = Math.floor(grayscale[i]);
            histogram[Math.min(255, Math.max(0, val))]++;
        }
        
        const total = grayscale.length;
        let sum = 0;
        for (let i = 0; i < 256; i++) {
            sum += i * histogram[i];
        }
        
        let sumB = 0;
        let wB = 0;
        let wF = 0;
        let max = 0;
        let threshold = 128;
        
        for (let i = 0; i < 256; i++) {
            wB += histogram[i];
            if (wB === 0) continue;
            
            wF = total - wB;
            if (wF === 0) break;
            
            sumB += i * histogram[i];
            
            const mB = sumB / wB;
            const mF = (sum - sumB) / wF;
            
            const between = wB * wF * (mB - mF) * (mB - mF);
            
            if (between > max) {
                max = between;
                threshold = i;
            }
        }
        
        return threshold;
    },

    analyzeInkDistribution(binary, grayscale, width, height) {
        let inkPixels = 0;
        let totalInkValue = 0;
        let inkValueVariance = 0;
        
        const inkValues = [];
        
        for (let i = 0; i < width * height; i++) {
            if (binary[i] === 1) {
                inkPixels++;
                const val = grayscale[i];
                totalInkValue += val;
                inkValues.push(val);
            }
        }
        
        const inkRatio = inkPixels / (width * height);
        
        const meanInkValue = inkPixels > 0 ? totalInkValue / inkPixels : 128;
        
        for (const val of inkValues) {
            inkValueVariance += (val - meanInkValue) ** 2;
        }
        inkValueVariance = inkPixels > 0 ? inkValueVariance / inkPixels : 0;
        const inkValueStd = Math.sqrt(inkValueVariance);
        
        const inkDensityScore = Math.max(0, Math.min(1, 1 - meanInkValue / 255));
        const inkVariationScore = Math.max(0, Math.min(1, inkValueStd / 60));
        
        return {
            inkRatio,
            meanInkValue,
            inkValueStd,
            inkDensityScore,
            inkVariationScore
        };
    },

    analyzeStrokeFeatures(binary, width, height) {
        const horizontalProfile = new Array(height).fill(0);
        const verticalProfile = new Array(width).fill(0);
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (binary[idx] === 1) {
                    horizontalProfile[y]++;
                    verticalProfile[x]++;
                }
            }
        }
        
        let strokeWidthSum = 0;
        let strokeWidthCount = 0;
        
        for (let y = 0; y < height; y++) {
            if (horizontalProfile[y] > 0) {
                let inStroke = false;
                let strokeStart = 0;
                for (let x = 0; x < width; x++) {
                    const idx = y * width + x;
                    if (binary[idx] === 1 && !inStroke) {
                        inStroke = true;
                        strokeStart = x;
                    } else if (binary[idx] === 0 && inStroke) {
                        inStroke = false;
                        const strokeWidth = x - strokeStart;
                        if (strokeWidth > 1 && strokeWidth < width * 0.3) {
                            strokeWidthSum += strokeWidth;
                            strokeWidthCount++;
                        }
                    }
                }
            }
        }
        
        const avgStrokeWidth = strokeWidthCount > 0 ? strokeWidthSum / strokeWidthCount : 3;
        
        const normalizedStrokeWidth = avgStrokeWidth / Math.sqrt(width * height) * 100;
        
        const strokeWidthVariation = this.calculateStrokeVariation(binary, width, height);
        
        const edgeRoughness = this.calculateEdgeRoughness(binary, width, height);
        
        return {
            avgStrokeWidth,
            normalizedStrokeWidth,
            strokeWidthVariation,
            edgeRoughness
        };
    },

    calculateStrokeVariation(binary, width, height) {
        const strokeWidths = [];
        
        for (let y = 0; y < height; y += 3) {
            let inStroke = false;
            let strokeStart = 0;
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (binary[idx] === 1 && !inStroke) {
                    inStroke = true;
                    strokeStart = x;
                } else if (binary[idx] === 0 && inStroke) {
                    inStroke = false;
                    const sw = x - strokeStart;
                    if (sw > 1 && sw < width * 0.3) {
                        strokeWidths.push(sw);
                    }
                }
            }
        }
        
        if (strokeWidths.length < 2) return 0.2;
        
        const mean = strokeWidths.reduce((a, b) => a + b, 0) / strokeWidths.length;
        const variance = strokeWidths.reduce((a, b) => a + (b - mean) ** 2, 0) / strokeWidths.length;
        const std = Math.sqrt(variance);
        
        return Math.min(1, std / mean);
    },

    calculateEdgeRoughness(binary, width, height) {
        let edgePixels = 0;
        let roughEdges = 0;
        
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                if (binary[idx] === 1) {
                    const neighbors = [
                        binary[idx - 1],
                        binary[idx + 1],
                        binary[idx - width],
                        binary[idx + width]
                    ];
                    const edgeNeighbors = neighbors.filter(n => n === 0).length;
                    if (edgeNeighbors > 0) {
                        edgePixels++;
                        
                        const diagNeighbors = [
                            binary[idx - width - 1],
                            binary[idx - width + 1],
                            binary[idx + width - 1],
                            binary[idx + width + 1]
                        ];
                        const diagEdges = diagNeighbors.filter(n => n === 0).length;
                        if (edgeNeighbors + diagEdges > 2) {
                            roughEdges++;
                        }
                    }
                }
            }
        }
        
        return edgePixels > 0 ? roughEdges / edgePixels : 0;
    },

    analyzeSlant(binary, width, height) {
        let totalAngle = 0;
        let angleCount = 0;
        const angles = [];
        
        const horizontalProfile = new Array(height).fill(0);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (binary[y * width + x] === 1) {
                    horizontalProfile[y]++;
                }
            }
        }
        
        let textLines = [];
        let inLine = false;
        let lineStart = 0;
        const lineThreshold = Math.max(1, width * 0.05);
        
        for (let y = 0; y < height; y++) {
            if (horizontalProfile[y] > lineThreshold && !inLine) {
                inLine = true;
                lineStart = y;
            } else if (horizontalProfile[y] < lineThreshold && inLine) {
                inLine = false;
                const lineEnd = y - 1;
                if (lineEnd - lineStart > 5) {
                    textLines.push({ start: lineStart, end: lineEnd });
                }
            }
        }
        
        if (textLines.length === 0) {
            textLines.push({ start: Math.floor(height * 0.2), end: Math.floor(height * 0.8) });
        }
        
        for (const line of textLines) {
            const lineHeight = line.end - line.start;
            const sampleY = line.start + Math.floor(lineHeight * 0.5);
            
            const leftEdges = [];
            const rightEdges = [];
            
            for (let y = line.start; y < line.end; y += 2) {
                let leftX = -1;
                let rightX = -1;
                
                for (let x = 0; x < width; x++) {
                    if (binary[y * width + x] === 1) {
                        leftX = x;
                        break;
                    }
                }
                
                for (let x = width - 1; x >= 0; x--) {
                    if (binary[y * width + x] === 1) {
                        rightX = x;
                        break;
                    }
                }
                
                if (leftX >= 0 && rightX >= 0 && rightX - leftX > lineHeight * 0.3) {
                    leftEdges.push({ y, x: leftX });
                    rightEdges.push({ y, x: rightX });
                }
            }
            
            if (leftEdges.length > 5) {
                const leftAngle = this.calculateEdgeAngle(leftEdges);
                const rightAngle = this.calculateEdgeAngle(rightEdges);
                
                if (isFinite(leftAngle)) {
                    totalAngle += leftAngle;
                    angleCount++;
                    angles.push(leftAngle);
                }
                if (isFinite(rightAngle)) {
                    totalAngle += rightAngle;
                    angleCount++;
                    angles.push(rightAngle);
                }
            }
        }
        
        const avgAngle = angleCount > 0 ? totalAngle / angleCount : 0;
        
        let angleVariance = 0;
        for (const angle of angles) {
            angleVariance += (angle - avgAngle) ** 2;
        }
        angleVariance = angles.length > 0 ? angleVariance / angles.length : 0;
        const angleStd = Math.sqrt(angleVariance);
        
        return {
            slantAngle: avgAngle,
            slantVariation: Math.min(1, angleStd / 10)
        };
    },

    calculateEdgeAngle(edgePoints) {
        if (edgePoints.length < 2) return 0;
        
        let sumX = 0, sumY = 0, sumXY = 0, sumY2 = 0;
        const n = edgePoints.length;
        
        for (const p of edgePoints) {
            sumX += p.x;
            sumY += p.y;
            sumXY += p.x * p.y;
            sumY2 += p.y * p.y;
        }
        
        const denominator = n * sumY2 - sumY * sumY;
        if (Math.abs(denominator) < 0.001) return 0;
        
        const slope = (n * sumXY - sumX * sumY) / denominator;
        
        const angle = Math.atan(slope) * 180 / Math.PI;
        
        return angle;
    },

    analyzeTexture(grayscale, binary, width, height) {
        let inkPixelCount = 0;
        let neighborVariation = 0;
        
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                if (binary[idx] === 1) {
                    inkPixelCount++;
                    
                    const centerVal = grayscale[idx];
                    let variation = 0;
                    
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (dx === 0 && dy === 0) continue;
                            const nidx = (y + dy) * width + (x + dx);
                            if (binary[nidx] === 1) {
                                variation += Math.abs(grayscale[nidx] - centerVal);
                            }
                        }
                    }
                    
                    neighborVariation += variation / 8;
                }
            }
        }
        
        const strokeTexture = inkPixelCount > 0 ? neighborVariation / inkPixelCount / 255 : 0;
        
        let splatterCount = 0;
        const minSplatterSize = 2;
        const maxSplatterSize = 15;
        
        const visited = new Uint8Array(width * height);
        
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                if (binary[idx] === 1 && visited[idx] === 0) {
                    const { size, isIsolated } = this.floodFillCheck(binary, visited, x, y, width, height, maxSplatterSize);
                    
                    if (size >= minSplatterSize && size <= maxSplatterSize && isIsolated) {
                        splatterCount++;
                    }
                }
            }
        }
        
        const splatterDensity = splatterCount / (width * height) * 10000;
        
        return {
            strokeTexture: Math.min(1, strokeTexture * 3),
            splatterDensity: Math.min(1, splatterDensity)
        };
    },

    floodFillCheck(binary, visited, startX, startY, width, height, maxSize) {
        const stack = [{ x: startX, y: startY }];
        let size = 0;
        let isIsolated = true;
        const targetX = startX;
        const targetY = startY;
        
        while (stack.length > 0 && size < maxSize + 1) {
            const { x, y } = stack.pop();
            
            if (x < 0 || x >= width || y < 0 || y >= height) continue;
            const idx = y * width + x;
            if (binary[idx] === 0 || visited[idx] === 1) continue;
            
            visited[idx] = 1;
            size++;
            
            if (Math.abs(x - targetX) > maxSize / 2 || Math.abs(y - targetY) > maxSize / 2) {
                isIsolated = false;
            }
            
            stack.push({ x: x + 1, y });
            stack.push({ x: x - 1, y });
            stack.push({ x, y: y + 1 });
            stack.push({ x, y: y - 1 });
        }
        
        if (size >= maxSize + 1) {
            isIsolated = false;
        }
        
        return { size, isIsolated };
    },

    mapToRenderParams(features) {
        const params = {};
        
        params.inkDensity = Math.round(40 + features.inkDensityScore * 60);
        
        params.strokeNoise = Math.round(10 + (features.edgeRoughness * 0.5 + features.strokeTexture * 0.3 + features.splatterDensity * 0.2) * 90);
        
        params.slantAngle = Math.max(-15, Math.min(15, features.slantAngle * 1.5));
        
        const variationScore = (features.strokeWidthVariation * 0.4 + features.inkVariationScore * 0.3 + features.slantVariation * 0.3);
        params.randomOffset = Math.round(0.5 + variationScore * 8);
        
        params.charSpacing = Math.round(-2 + (1 - features.inkRatio * 3) * 6);
        params.charSpacing = Math.max(-5, Math.min(10, params.charSpacing));
        
        const baseLineHeight = 1.6;
        const lineHeightAdjust = (1 - features.inkRatio * 2) * 0.4;
        params.lineHeight = Math.round((baseLineHeight + lineHeightAdjust) * 10) / 10;
        params.lineHeight = Math.max(1.2, Math.min(2.5, params.lineHeight));
        
        return params;
    },

    async analyzeAndMap(imageElement) {
        const features = await this.analyzeImage(imageElement);
        const params = this.mapToRenderParams(features);
        return { features, params };
    }
};

if (typeof window !== 'undefined') {
    window.StyleTransfer = StyleTransfer;
}
