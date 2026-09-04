package com.moyuyu.yuaiagentpro.tools;

import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;

@Component
public class CalculatorTools {

    private static final MathContext MATH_CONTEXT = new MathContext(16, RoundingMode.HALF_UP);

    @Tool(description = "Perform a basic arithmetic operation. Use this for exact calculations involving two numbers.")
    public String calculate(
            @ToolParam(description = "Left operand") BigDecimal left,
            @ToolParam(description = "Arithmetic operator: add, subtract, multiply, or divide") String operator,
            @ToolParam(description = "Right operand") BigDecimal right) {
        if (left == null || right == null) {
            throw new IllegalArgumentException("left and right operands are required");
        }
        if (operator == null || operator.isBlank()) {
            throw new IllegalArgumentException("operator is required");
        }

        BigDecimal result = switch (operator.trim().toLowerCase()) {
            case "add", "+" -> left.add(right, MATH_CONTEXT);
            case "subtract", "-" -> left.subtract(right, MATH_CONTEXT);
            case "multiply", "*", "x" -> left.multiply(right, MATH_CONTEXT);
            case "divide", "/" -> {
                if (BigDecimal.ZERO.compareTo(right) == 0) {
                    throw new IllegalArgumentException("division by zero is not allowed");
                }
                yield left.divide(right, MATH_CONTEXT);
            }
            default -> throw new IllegalArgumentException("unsupported operator: " + operator);
        };

        return result.stripTrailingZeros().toPlainString();
    }
}
