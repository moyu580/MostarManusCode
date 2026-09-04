package com.moyuyu.yuaiagentpro.tools;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class CalculatorToolsTest {

    private final CalculatorTools calculatorTools = new CalculatorTools();

    @Test
    void shouldCalculateBasicOperations() {
        assertEquals("15", calculatorTools.calculate(new BigDecimal("10"), "add", new BigDecimal("5")));
        assertEquals("5", calculatorTools.calculate(new BigDecimal("10"), "subtract", new BigDecimal("5")));
        assertEquals("50", calculatorTools.calculate(new BigDecimal("10"), "multiply", new BigDecimal("5")));
        assertEquals("2", calculatorTools.calculate(new BigDecimal("10"), "divide", new BigDecimal("5")));
    }

    @Test
    void shouldRejectDivisionByZero() {
        assertThrows(IllegalArgumentException.class,
                () -> calculatorTools.calculate(new BigDecimal("10"), "divide", BigDecimal.ZERO));
    }
}
